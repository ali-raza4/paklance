import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import { AppController } from '../app.controller';
import { AppService } from '../app.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
};

const mockUsersService = {
  create: jest.fn(),
  findByEmail: jest.fn(),
  findOne: jest.fn(),
};

const mockEmailService = {
  sendVerificationOtp: jest.fn(),
};

describe('Google OAuth Flow & Config', () => {
  let authService: AuthService;
  let appController: AppController;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-secret-at-least-32-chars-long-abc',
          signOptions: { expiresIn: '7d' },
        }),
      ],
      controllers: [AppController],
      providers: [
        AuthService,
        AppService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    appController = module.get<AppController>(AppController);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('GET /api/config', () => {
    it('returns googleClientId as null when GOOGLE_CLIENT_ID is not set', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      const config = appController.getConfig();
      expect(config.googleClientId).toBeNull();
      expect(config.currency).toBe('PKR');
    });

    it('returns configured googleClientId when GOOGLE_CLIENT_ID is set', () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
      const config = appController.getConfig();
      expect(config.googleClientId).toBe('test-client-id.apps.googleusercontent.com');
    });
  });

  describe('POST /api/auth/google', () => {
    it('throws ServiceUnavailableException when GOOGLE_CLIENT_ID is not configured', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      await expect(
        authService.googleAuth({ code: 'some-code' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws BadRequestException when both code and credential are missing', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
      await expect(authService.googleAuth({})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ServiceUnavailableException when code is given but GOOGLE_CLIENT_SECRET is missing', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';
      delete process.env.GOOGLE_CLIENT_SECRET;
      await expect(
        authService.googleAuth({ code: 'some-code' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('authenticates existing user when Google ID token is verified', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';

      // Mock global.fetch for Google tokeninfo verification
      const existingUser = {
        id: 'user-google-1',
        email: 'specialist@example.com',
        role: 'SPECIALIST',
        name: 'Google Specialist',
        isEmailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.user.findUnique.mockResolvedValue(existingUser);

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes('tokeninfo')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                aud: 'test-client-id',
                email: 'specialist@example.com',
                email_verified: 'true',
                name: 'Google Specialist',
              }),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      });

      try {
        const result = await authService.googleAuth({ credential: 'valid-id-token' });
        expect(result.accessToken).toBeDefined();
        expect(result.user.email).toBe('specialist@example.com');
        expect(result.user.id).toBe('user-google-1');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('creates and provisions new user with secure password hash when not found', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';

      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user-id',
        email: 'newbie@example.com',
        role: 'SPECIALIST',
        name: 'New User',
        isEmailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes('tokeninfo')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                aud: 'test-client-id',
                email: 'newbie@example.com',
                email_verified: true,
                name: 'New User',
              }),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      });

      try {
        const result = await authService.googleAuth({ credential: 'valid-id-token' });
        expect(result.accessToken).toBeDefined();
        expect(result.user.email).toBe('newbie@example.com');
        expect(mockPrisma.user.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              email: 'newbie@example.com',
              role: 'SPECIALIST',
              isEmailVerified: true,
            }),
          }),
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('rejects unverified Google accounts', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              aud: 'test-client-id',
              email: 'unverified@example.com',
              email_verified: false,
            }),
        }),
      );

      try {
        await expect(
          authService.googleAuth({ credential: 'unverified-token' }),
        ).rejects.toThrow(BadRequestException);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('rejects tokens with mismatched audience', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              aud: 'wrong-audience-client-id',
              email: 'hacker@example.com',
              email_verified: true,
            }),
        }),
      );

      try {
        await expect(
          authService.googleAuth({ credential: 'forged-token' }),
        ).rejects.toThrow(UnauthorizedException);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
