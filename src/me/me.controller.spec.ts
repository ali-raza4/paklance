import { Test, TestingModule } from '@nestjs/testing';
import { MeController } from './me.controller';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { StorageService } from '../storage/storage.service';
import { ProfilesService } from '../profiles/profiles.service';
import { Availability, Role } from '@prisma/client';

describe('MeController', () => {
  let controller: MeController;

  const mockUser = {
    id: 'user-123',
    email: 'test@paklance.com',
    role: Role.SPECIALIST,
    name: 'Original Name',
    skills: ['React', 'Node.js'],
    headline: 'Full Stack Dev',
    bio: 'Experienced developer',
    city: 'Lahore',
    country: 'Pakistan',
    hourlyRate: 5000,
    avatarUrl: 'https://example.com/avatar.jpg',
    availability: Availability.AVAILABLE,
    isEmailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    portfolioItems: [],
  };

  const mockPrisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(mockUser),
      update: jest.fn().mockImplementation(({ data }) => {
        return Promise.resolve({
          ...mockUser,
          ...data,
          hourlyRate: data.hourlyRate !== undefined ? data.hourlyRate : mockUser.hourlyRate,
        });
      }),
    },
  };

  const mockJwt = {
    verify: jest.fn().mockReturnValue({ sub: 'user-123', email: 'test@paklance.com', role: 'SPECIALIST' }),
  };

  const mockStorage = {
    uploadFile: jest.fn().mockResolvedValue('https://example.com/new-avatar.jpg'),
  };

  const mockProfiles = {
    addPortfolioItem: jest.fn().mockResolvedValue({ id: 'item-1', title: 'New Item' }),
    removePortfolioItem: jest.fn().mockResolvedValue({ id: 'item-1' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: StorageService, useValue: mockStorage },
        { provide: ProfilesService, useValue: mockProfiles },
      ],
    }).compile();

    controller = module.get<MeController>(MeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /me', () => {
    it('should return user data when valid Bearer token is provided', async () => {
      const req: any = { headers: { authorization: 'Bearer valid_token' } };
      const res = await controller.getMe(req);
      expect(res).toBeDefined();
      expect(res.user).toBeDefined();
      expect(res.user.id).toBe('user-123');
      expect(res.user.fullName).toBe('Original Name');
      expect(res.user.skills).toEqual(['React', 'Node.js']);
      expect(res.user.hourlyRate).toBe(5000);
    });

    it('should return { user: null } when no token is provided', async () => {
      const req: any = { headers: {} };
      const res = await controller.getMe(req);
      expect(res).toEqual({ user: null });
    });
  });

  describe('PATCH /me', () => {
    it('should update skills, name, bio, and hourlyRate', async () => {
      const req: any = { user: { id: 'user-123' } };
      const dto = {
        skills: ['React', 'TypeScript', 'PostgreSQL'],
        fullName: 'Updated Name',
        bio: 'Updated bio information',
        hourlyRate: 6500,
        city: 'Karachi',
      };

      const res = await controller.patchMe(req, dto);
      expect(res.user.skills).toEqual(['React', 'TypeScript', 'PostgreSQL']);
      expect(res.user.name).toBe('Updated Name');
      expect(res.user.fullName).toBe('Updated Name');
      expect(res.user.bio).toBe('Updated bio information');
      expect(res.user.city).toBe('Karachi');
      expect(res.user.hourlyRate).toBe(6500);
      expect(res.user.hourly_rate).toBe(6500);
    });

    it('should update avatarUrl/photo', async () => {
      const req: any = { user: { id: 'user-123' } };
      const dto = { photo: 'https://example.com/updated.jpg' };

      const res = await controller.patchMe(req, dto);
      expect(res.user.avatarUrl).toBe('https://example.com/updated.jpg');
      expect(res.user.photo).toBe('https://example.com/updated.jpg');
    });
  });

  describe('GET and PUT /me/profile', () => {
    it('should return extended profile on GET /me/profile', async () => {
      const req: any = { user: { id: 'user-123' } };
      const res = await controller.getMyProfile(req);
      expect(res.profile).toBeDefined();
      expect(res.profile.skills).toEqual(['React', 'Node.js']);
      expect(res.items).toEqual([]);
    });

    it('should update extended profile on PUT /me/profile', async () => {
      const req: any = { user: { id: 'user-123' } };
      const res = await controller.putMyProfile(req, {
        headline: 'New Headline',
        bio: 'New Bio',
        hourlyRate: 7000,
      });
      expect(res.profile.headline).toBe('New Headline');
      expect(res.profile.bio).toBe('New Bio');
      expect(res.profile.hourlyRate).toBe(7000);
    });
  });

  describe('Photo and portfolio items', () => {
    it('should remove photo on DELETE /me/photo', async () => {
      const req: any = { user: { id: 'user-123' } };
      const res = await controller.removePhoto(req);
      expect(res.user.avatarUrl).toBeNull();
      expect(res.user.photo).toBeNull();
    });

    it('should add portfolio item', async () => {
      const req: any = { user: { id: 'user-123' } };
      const res = await controller.addPortfolioItem(req, { title: 'Project 1' });
      expect(res.item).toBeDefined();
      expect(res.item.title).toBe('New Item');
    });

    it('should remove portfolio item', async () => {
      const req: any = { user: { id: 'user-123' } };
      const res = await controller.removePortfolioItem(req, 'item-1');
      expect(res.ok).toBe(true);
    });
  });

  describe('Video introduction', () => {
    it('should save video link on PUT /me/profile/video', async () => {
      const req: any = { user: { id: 'user-123' } };
      const res = await controller.saveVideo(req, { url: 'https://youtube.com/watch?v=dQw4w9WgXcQ' });
      expect(res.video).toBeDefined();
      expect(res.video.kind).toBe('link');
      expect(res.video.url).toBe('https://youtube.com/watch?v=dQw4w9WgXcQ');
    });

    it('should reject invalid video links', async () => {
      const req: any = { user: { id: 'user-123' } };
      await expect(controller.saveVideo(req, { url: 'https://example.com/invalid' })).rejects.toThrow();
    });

    it('should clear video when url is null or empty', async () => {
      const req: any = { user: { id: 'user-123' } };
      const res = await controller.saveVideo(req, { url: null });
      expect(res.video).toBeNull();
    });

    it('should upload video file with 10s, 12s, and 15s duration', async () => {
      const req: any = { user: { id: 'user-123' } };
      const file: any = {
        originalname: 'my-intro.mp4',
        mimetype: 'video/mp4',
        size: 1024 * 1024,
        buffer: Buffer.from('fake-video'),
      };
      for (const dur of [10, 12, 15]) {
        const res = await controller.uploadVideo(req, file, { duration: String(dur) });
        expect(res.video).toBeDefined();
        expect(res.video.kind).toBe('upload');
        expect(res.video.duration).toBe(dur);
      }
    });

    it('should reject video shorter than 10 seconds or longer than 15 seconds', async () => {
      const req: any = { user: { id: 'user-123' } };
      const file: any = {
        originalname: 'my-intro.mp4',
        mimetype: 'video/mp4',
        size: 1024 * 1024,
        buffer: Buffer.from('fake-video'),
      };
      await expect(controller.uploadVideo(req, file, { duration: '5' })).rejects.toThrow('Record at least 10 seconds.');
      await expect(controller.uploadVideo(req, file, { duration: '20' })).rejects.toThrow('Keep your video between 10 and 15 seconds.');
    });
  });
});
