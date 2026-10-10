import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Register creates an unverified user account, generates a secure 6-digit OTP,
   * sends it via EmailService, and requires verification before activation.
   * OTP is NEVER returned in the API response.
   */
  async register(data: { email: string; password: string; role?: Role }) {
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes validity
    const now = new Date();

    const user = await this.usersService.create({
      email: data.email.toLowerCase().trim(),
      password: data.password,
      role: data.role || Role.SPECIALIST,
      isEmailVerified: false,
      emailVerifyOtp: otp,
      emailVerifyExpires: expiresAt,
      emailVerifyLastSentAt: now,
    });

    // Send REAL verification email via configured provider.
    // If the provider fails, throw an error and do not falsely claim success.
    await this.emailService.sendVerificationOtp(user.email, otp);

    return {
      message: 'Verification code sent to your email. Please enter the 6-digit code to activate your account.',
      email: user.email,
      requiresVerification: true,
    };
  }

  /**
   * Verify single-use OTP, validate expiration, activate account, and issue JWT.
   */
  async verifyEmail(data: { email: string; otp: string }) {
    const normalizedEmail = data.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new NotFoundException('Account not found');
    }

    if (user.isEmailVerified) {
      const token = this.jwtService.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
      });
      return {
        message: 'Account is already verified.',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          name: user.name,
          skills: user.skills || [],
          avatarUrl: user.avatarUrl || null,
          isEmailVerified: true,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        accessToken: token,
      };
    }

    if (!user.emailVerifyOtp || !user.emailVerifyExpires) {
      throw new BadRequestException('No verification request found. Please request a new code.');
    }

    if (new Date() > new Date(user.emailVerifyExpires)) {
      throw new BadRequestException('Verification code has expired. Please request a new one.');
    }

    if (user.emailVerifyOtp.trim() !== data.otp.trim()) {
      throw new BadRequestException('Invalid verification code.');
    }

    // Activate user and clear single-use OTP
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        emailVerifyOtp: null,
        emailVerifyExpires: null,
      },
    });

    const token = this.jwtService.sign({
      sub: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
    });

    return {
      message: 'Email verified successfully. Account is now active.',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        name: updatedUser.name,
        skills: updatedUser.skills || [],
        avatarUrl: updatedUser.avatarUrl || null,
        isEmailVerified: true,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      },
      accessToken: token,
    };
  }

  /**
   * Resend verification OTP with strict 60-second rate limiting.
   */
  async resendVerification(data: { email: string }) {
    const normalizedEmail = data.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      // Return neutral message to prevent user enumeration
      return {
        message: 'If the email exists and is unverified, a new verification code has been dispatched.',
      };
    }

    if (user.isEmailVerified) {
      return {
        message: 'This email account is already verified. Please proceed to log in.',
      };
    }

    const now = Date.now();
    if (user.emailVerifyLastSentAt) {
      const elapsedMs = now - new Date(user.emailVerifyLastSentAt).getTime();
      if (elapsedMs < 60000) {
        const remainingSec = Math.ceil((60000 - elapsedMs) / 1000);
        throw new BadRequestException(
          `Please wait ${remainingSec} seconds before requesting another verification code.`,
        );
      }
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(now + 15 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifyOtp: otp,
        emailVerifyExpires: expiresAt,
        emailVerifyLastSentAt: new Date(now),
      },
    });

    // Send REAL verification email via configured provider
    await this.emailService.sendVerificationOtp(user.email, otp);

    return {
      message: 'A new 6-digit verification code has been sent to your email.',
    };
  }

  async login(data: { email: string; password: string }) {
    const normalizedEmail = data.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      data.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isEmailVerified) {
      throw new UnauthorizedException(
        'Email not verified. Please verify your email before logging in.',
      );
    }

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        skills: user.skills || [],
        avatarUrl: user.avatarUrl || null,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      accessToken: token,
    };
  }

  /**
   * Google OAuth handler: exchanges authorization code or verifies ID token,
   * finds or provisions specialist user, and returns user data + JWT accessToken.
   */
  async googleAuth(data: { code?: string; credential?: string }) {
    const clientId =
      process.env.GOOGLE_CLIENT_ID || process.env.Google_Client_Id;
    const clientSecret =
      process.env.GOOGLE_CLIENT_SECRET || process.env.Google_Client_Secret;

    if (!clientId) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured on this server.',
      );
    }

    const code = typeof data.code === 'string' ? data.code.trim() : '';
    const credential =
      typeof data.credential === 'string' ? data.credential.trim() : '';

    if (!code && !credential) {
      throw new BadRequestException(
        'Google authorization code or credential is required.',
      );
    }

    let idToken = credential;

    if (code) {
      if (!clientSecret) {
        throw new ServiceUnavailableException(
          'Google client secret is not configured on this server.',
        );
      }

      const tokenUrl = 'https://oauth2.googleapis.com/token';
      const params = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: 'postmessage',
        grant_type: 'authorization_code',
      });

      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!tokenRes.ok) {
        throw new UnauthorizedException(
          'Failed to exchange Google authorization code.',
        );
      }

      const tokenData: any = await tokenRes.json();
      idToken = tokenData.id_token;
    }

    if (!idToken) {
      throw new UnauthorizedException('No ID token received from Google.');
    }

    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );

    if (!verifyRes.ok) {
      throw new UnauthorizedException('Invalid Google token.');
    }

    const payload: any = await verifyRes.json();

    if (payload.aud !== clientId) {
      throw new UnauthorizedException('Google token audience mismatch.');
    }

    const email = (payload.email || '').toLowerCase().trim();
    const isEmailVerified =
      payload.email_verified === 'true' || payload.email_verified === true;

    if (!email || !isEmailVerified) {
      throw new BadRequestException('Google account email is not verified.');
    }

    let user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      if (!user.isEmailVerified) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { isEmailVerified: true },
        });
      }
    } else {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 10);
      user = await this.prisma.user.create({
        data: {
          email,
          name: payload.name || null,
          passwordHash,
          role: Role.SPECIALIST,
          isEmailVerified: true,
          avatarUrl: payload.picture || null,
        },
      });
    }

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      message: 'Google sign-in successful.',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        skills: user.skills || [],
        avatarUrl: user.avatarUrl || null,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      accessToken: token,
    };
  }

  /**
   * Generates a cryptographically secure password reset token, stores its SHA-256 hash
   * in the database with a 1-hour expiration, and dispatches the reset email.
   * Returns a generic response to prevent account enumeration.
   */
  async forgotPassword(data: { email: string }) {
    const GENERIC_RESPONSE = {
      message: 'If an account exists with this email, a password reset link has been sent.',
    };

    if (!data.email) {
      return GENERIC_RESPONSE;
    }

    const email = data.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      this.logger.log(`[ForgotPassword] Request for non-existent email: ${email}`);
      return GENERIC_RESPONSE;
    }

    // Rate-limiting check: do not spam emails if requested within the last 60 seconds
    if (user.resetPasswordLastSentAt) {
      const msSinceLast = Date.now() - new Date(user.resetPasswordLastSentAt).getTime();
      if (msSinceLast < 60 * 1000) {
        this.logger.log(
          `[ForgotPassword] Throttled request for ${email} (${Math.round(msSinceLast / 1000)}s since last)`,
        );
        return GENERIC_RESPONSE;
      }
    }

    // Generate 32-byte secure token (64 hex characters)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour validity

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: tokenHash,
        resetPasswordExpires: expiresAt,
        resetPasswordLastSentAt: new Date(),
      },
    });

    const frontendBaseUrl =
      process.env.FRONTEND_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      'https://www.paklance.com';
    const cleanBase = frontendBaseUrl.replace(/\/+$/, '');
    const resetUrl = `${cleanBase}/reset-password?token=${rawToken}`;

    try {
      await this.emailService.sendPasswordResetEmail(user.email, resetUrl);
      this.logger.log(`[ForgotPassword] Reset email sent to ${user.email}`);
    } catch (err: any) {
      this.logger.error(
        `[ForgotPassword] Email dispatch failed for ${user.email}: ${err?.message}`,
      );
      throw err;
    }

    return GENERIC_RESPONSE;
  }

  /**
   * Verifies if a reset token is valid and not expired.
   */
  async verifyResetToken(token: string) {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('Reset token is required.');
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const user = await this.prisma.user.findFirst({
      where: {
        resetPasswordToken: tokenHash,
        resetPasswordExpires: { gt: new Date() },
      },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new BadRequestException('Password reset link is invalid or has expired.');
    }

    return {
      valid: true,
      email: user.email,
    };
  }

  /**
   * Resets the user's password using the token, hashes with bcrypt,
   * invalidates the token, and updates passwordHash without touching other profile data.
   */
  async resetPassword(data: { token: string; newPassword: string }) {
    if (!data.token || typeof data.token !== 'string') {
      throw new BadRequestException('Reset token is required.');
    }

    if (!data.newPassword || data.newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long.');
    }

    // Require both letters and numbers for password strength
    const hasLetter = /[a-zA-Z]/.test(data.newPassword);
    const hasNumber = /[0-9]/.test(data.newPassword);
    if (!hasLetter || !hasNumber) {
      throw new BadRequestException(
        'Password must contain at least one letter and one number.',
      );
    }

    const tokenHash = crypto.createHash('sha256').update(data.token.trim()).digest('hex');
    const user = await this.prisma.user.findFirst({
      where: {
        resetPasswordToken: tokenHash,
        resetPasswordExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Password reset link is invalid or has expired.');
    }

    const newPasswordHash = await bcrypt.hash(data.newPassword, 10);

    // Atomically update password and invalidate reset token (single-use guarantee)
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        resetPasswordToken: null,
        resetPasswordExpires: null,
        isEmailVerified: true,
      },
    });

    this.logger.log(
      `[ResetPassword] Password successfully reset for user ${user.id} (${user.email})`,
    );

    return {
      message:
        'Your password has been successfully reset. You may now log in with your new password.',
    };
  }
}


