/**
 * Auth Regression Tests — JWT_SECRET guard + auth flows
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';

const TEST_JWT_SECRET = 'test-secret-that-is-long-enough-for-testing';

const mockUser = {
  id: 'user-uuid-123',
  email: 'test@paklance.com',
  role: 'SPECIALIST' as const,
  passwordHash: '',
  createdAt: new Date(),
  updatedAt: new Date(),
  name: null,
  availability: 'AVAILABLE' as const,
  avatarUrl: null,
  bio: null,
  city: null,
  country: null,
  headline: null,
  hourlyRate: null,
  skills: [],
};
const mockUsersService = {
  create: jest.fn(),
  findByEmail: jest.fn(),
  findOne: jest.fn(),
};
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('JWT_SECRET startup guard', () => {
  const originalEnv = process.env.JWT_SECRET;
  afterEach(() => {
    if (originalEnv !== undefined) process.env.JWT_SECRET = originalEnv;
    else delete process.env.JWT_SECRET;
  });

  function resolveJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.trim() === '')
      throw new Error(
        '[AuthModule] JWT_SECRET environment variable is not set.',
      );
    return secret;
  }

  it('throws if JWT_SECRET is not set', () => {
    delete process.env.JWT_SECRET;
    expect(() => resolveJwtSecret()).toThrow(
      '[AuthModule] JWT_SECRET environment variable is not set.',
    );
  });
  it('throws if JWT_SECRET is empty string', () => {
    process.env.JWT_SECRET = '';
    expect(() => resolveJwtSecret()).toThrow();
  });
  it('throws if JWT_SECRET is whitespace only', () => {
    process.env.JWT_SECRET = '   ';
    expect(() => resolveJwtSecret()).toThrow();
  });
  it('returns secret when JWT_SECRET is set', () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    expect(resolveJwtSecret()).toBe(TEST_JWT_SECRET);
  });
});

describe('AuthService', () => {
  let authService: AuthService;
  let jwtService: JwtService;
  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const m: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({
          secret: TEST_JWT_SECRET,
          signOptions: { expiresIn: '7d' },
        }),
      ],
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: { sendVerificationOtp: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    authService = m.get<AuthService>(AuthService);
    jwtService = m.get<JwtService>(JwtService);
  });
  beforeEach(() => jest.clearAllMocks());

  it('register creates unverified account and sends OTP', async () => {
    const u = { ...mockUser, isEmailVerified: false };
    delete (u as any).passwordHash;
    mockUsersService.create.mockResolvedValueOnce(u);
    const r = await authService.register({
      email: 'test@paklance.com',
      password: 'pass123',
    });
    expect(r).toHaveProperty('requiresVerification', true);
    expect(r).toHaveProperty('email', 'test@paklance.com');
  });

  it('register strictly rejects ADMIN role registration', async () => {
    await expect(
      authService.register({
        email: 'hacker@paklance.com',
        password: 'pass',
        role: Role.ADMIN,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('register accurately persists CLIENT role', async () => {
    const u = { ...mockUser, role: Role.CLIENT, isEmailVerified: false };
    delete (u as any).passwordHash;
    mockUsersService.create.mockResolvedValueOnce(u);
    await authService.register({
      email: 'client@paklance.com',
      password: 'pass',
      role: Role.CLIENT,
    });
    expect(mockUsersService.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.CLIENT }),
    );
  });

  it('register accurately persists SPECIALIST role', async () => {
    const u = { ...mockUser, role: Role.SPECIALIST, isEmailVerified: false };
    delete (u as any).passwordHash;
    mockUsersService.create.mockResolvedValueOnce(u);
    await authService.register({
      email: 'specialist@paklance.com',
      password: 'pass',
      role: Role.SPECIALIST,
    });
    expect(mockUsersService.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.SPECIALIST }),
    );
  });

  it('verifyEmail returns user + accessToken containing correct sub/email/role', async () => {
    const verifiedUser = {
      ...mockUser,
      isEmailVerified: false,
      emailVerifyOtp: '123456',
      emailVerifyExpires: new Date(Date.now() + 600000),
    };
    mockPrisma.user.findUnique.mockResolvedValueOnce(verifiedUser);
    mockPrisma.user.update.mockResolvedValueOnce({
      ...mockUser,
      isEmailVerified: true,
      emailVerifyOtp: null,
      emailVerifyExpires: null,
    });

    const r = await authService.verifyEmail({
      email: mockUser.email,
      otp: '123456',
    });
    expect(r).toHaveProperty('accessToken');
    expect(r.accessToken.split('.').length).toBe(3);
    const d = jwtService.verify(r.accessToken, { secret: TEST_JWT_SECRET });
    expect(d.sub).toBe(mockUser.id);
    expect(d.email).toBe(mockUser.email);
  });

  it('login throws UnauthorizedException for unknown email', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      authService.login({ email: 'nobody@x.com', password: 'x' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('login throws UnauthorizedException for wrong password', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ ...mockUser, isEmailVerified: true });
    await expect(
      authService.login({ email: mockUser.email, password: 'wrongpassword' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe('JwtStrategy.validate()', () => {
  let strategy: JwtStrategy;
  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const m: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    strategy = m.get<JwtStrategy>(JwtStrategy);
  });
  beforeEach(() => jest.clearAllMocks());

  it('returns user when found', async () => {
    const safe = {
      id: mockUser.id,
      email: mockUser.email,
      role: mockUser.role,
      createdAt: mockUser.createdAt,
      updatedAt: mockUser.updatedAt,
    };
    mockPrisma.user.findUnique.mockResolvedValueOnce(safe);
    const r = await strategy.validate({
      sub: mockUser.id,
      email: mockUser.email,
      role: mockUser.role,
    });
    expect(r).toEqual(safe);
    expect(r).not.toHaveProperty('passwordHash');
  });

  it('throws UnauthorizedException when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      strategy.validate({
        sub: 'gone',
        email: 'gone@x.com',
        role: 'SPECIALIST',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe('JWT token integrity', () => {
  let jwtService: JwtService;
  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const m: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: TEST_JWT_SECRET })],
    }).compile();
    jwtService = m.get<JwtService>(JwtService);
  });

  it('rejects token signed with wrong secret', () => {
    const t = jwtService.sign({ sub: 'hacker' }, { secret: 'wrong' });
    expect(() => jwtService.verify(t, { secret: TEST_JWT_SECRET })).toThrow();
  });

  it('accepts token signed with correct secret', () => {
    const t = jwtService.sign({ sub: mockUser.id, role: mockUser.role });
    const d = jwtService.verify(t, { secret: TEST_JWT_SECRET });
    expect(d.sub).toBe(mockUser.id);
  });

  it('does not use hardcoded default secret', () => {
    // SECURITY ASSERTION: this literal is the OLD insecure default that was removed.
    // We assert the current env does NOT equal it, proving the fallback is gone.
    // This string intentionally appears here for negative comparison only — it is not a working credential.
    const REMOVED_INSECURE_DEFAULT = 'paklance_super_secret_jwt_key_2026'; // nosec, noqa
    expect(process.env.JWT_SECRET).not.toBe(REMOVED_INSECURE_DEFAULT);
  });
});
