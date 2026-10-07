import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  VerifyEmailDto,
  ResendVerificationDto,
  GoogleAuthDto,
} from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({
    summary: 'Register a new user (CLIENT, SPECIALIST, or ADMIN) and send verification OTP',
  })
  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @ApiOperation({ summary: 'Verify 6-digit email OTP to activate account and receive JWT' })
  @HttpCode(HttpStatus.OK)
  @Post('verify-email')
  verifyEmail(@Body() body: VerifyEmailDto) {
    return this.authService.verifyEmail(body);
  }

  @ApiOperation({ summary: 'Resend 6-digit email verification OTP with rate limiting' })
  @HttpCode(HttpStatus.OK)
  @Post('resend-verification')
  resendVerification(@Body() body: ResendVerificationDto) {
    return this.authService.resendVerification(body);
  }

  @ApiOperation({ summary: 'Login and receive JWT token (verified users only)' })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @ApiOperation({ summary: 'Authenticate or register via Google OAuth (returns user and JWT)' })
  @HttpCode(HttpStatus.OK)
  @Post('google')
  googleAuth(@Body() body: GoogleAuthDto) {
    return this.authService.googleAuth(body);
  }
}

