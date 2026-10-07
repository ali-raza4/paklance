import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
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
}


