import { calculateProfileCompletion } from './profile-completion.util';
import { ProfilesService } from './profiles.service';
import { NotFoundException } from '@nestjs/common';

describe('Profile Completion & 50% Visibility Rules', () => {
  describe('calculateProfileCompletion', () => {
    it('returns 0% for a blank specialist profile', () => {
      const res = calculateProfileCompletion({
        role: 'SPECIALIST',
        name: '',
        headline: '',
        bio: '',
        city: '',
        avatarUrl: '',
        skills: [],
        hourlyRate: null,
        portfolioItems: [],
      });
      expect(res.percentage).toBe(0);
      expect(res.isCompleteEnoughForPublic).toBe(false);
      expect(res.missingFields.length).toBe(8);
    });

    it('returns 25% (2 of 8 fields) for specialist', () => {
      const res = calculateProfileCompletion({
        role: 'SPECIALIST',
        name: 'Ahmad Khan',
        headline: 'React Developer',
        bio: '',
        city: '',
        avatarUrl: '',
        skills: [],
        hourlyRate: null,
        portfolioItems: [],
      });
      expect(res.percentage).toBe(25);
      expect(res.isCompleteEnoughForPublic).toBe(false);
    });

    it('returns 38% (3 of 8 fields) for specialist', () => {
      const res = calculateProfileCompletion({
        role: 'SPECIALIST',
        name: 'Ahmad Khan',
        headline: 'React Developer',
        bio: 'Passionate frontend engineer with 5 years experience.',
        city: '',
        avatarUrl: '',
        skills: [],
        hourlyRate: null,
        portfolioItems: [],
      });
      expect(res.percentage).toBe(38);
      expect(res.isCompleteEnoughForPublic).toBe(false);
    });

    it('returns EXACTLY 50% (4 of 8 fields) for specialist and marks hidden', () => {
      const res = calculateProfileCompletion({
        role: 'SPECIALIST',
        name: 'Ahmad Khan',
        headline: 'React Developer',
        bio: 'Passionate frontend engineer with 5 years experience.',
        city: 'Lahore',
        avatarUrl: '',
        skills: [],
        hourlyRate: null,
        portfolioItems: [],
      });
      expect(res.percentage).toBe(50);
      // Strictly greater than 50% required, so 50% is FALSE
      expect(res.isCompleteEnoughForPublic).toBe(false);
    });

    it('returns 63% (5 of 8 fields) for specialist and marks visible', () => {
      const res = calculateProfileCompletion({
        role: 'SPECIALIST',
        name: 'Ahmad Khan',
        headline: 'React Developer',
        bio: 'Passionate frontend engineer with 5 years experience.',
        city: 'Lahore',
        avatarUrl: '',
        skills: ['React', 'TypeScript'],
        hourlyRate: null,
        portfolioItems: [],
      });
      expect(res.percentage).toBe(63);
      expect(res.isCompleteEnoughForPublic).toBe(true);
    });

    it('returns 75% (6 of 8 fields) for specialist', () => {
      const res = calculateProfileCompletion({
        role: 'SPECIALIST',
        name: 'Ahmad Khan',
        headline: 'React Developer',
        bio: 'Passionate frontend engineer with 5 years experience.',
        city: 'Lahore',
        avatarUrl: 'https://paklance.com/avatar.jpg',
        skills: ['React', 'TypeScript'],
        hourlyRate: null,
        portfolioItems: [],
      });
      expect(res.percentage).toBe(75);
      expect(res.isCompleteEnoughForPublic).toBe(true);
    });

    it('returns 100% (8 of 8 fields) for specialist', () => {
      const res = calculateProfileCompletion({
        role: 'SPECIALIST',
        name: 'Ahmad Khan',
        headline: 'React Developer',
        bio: 'Passionate frontend engineer with 5 years experience.',
        city: 'Lahore',
        avatarUrl: 'https://paklance.com/avatar.jpg',
        skills: ['React', 'TypeScript'],
        hourlyRate: 3500,
        portfolioItems: [{ id: 'p1', kind: 'portfolio', title: 'Fintech App' }],
      });
      expect(res.percentage).toBe(100);
      expect(res.isCompleteEnoughForPublic).toBe(true);
      expect(res.missingFields.length).toBe(0);
    });

    it('calculates client completion across 5 role-specific fields', () => {
      const client0 = calculateProfileCompletion({
        role: 'CLIENT',
        name: '',
      });
      expect(client0.percentage).toBe(0);

      const client40 = calculateProfileCompletion({
        role: 'CLIENT',
        name: 'Paklance Admin',
        headline: 'Platform Administrator',
        bio: '',
        city: '',
        avatarUrl: '',
      });
      expect(client40.percentage).toBe(40);

      const client100 = calculateProfileCompletion({
        role: 'CLIENT',
        name: 'Fatima Zahra',
        headline: 'Tech Recruiter',
        bio: 'Hiring top software engineers for venture backed startups.',
        city: 'Karachi',
        avatarUrl: 'https://paklance.com/client.jpg',
      });
      expect(client100.percentage).toBe(100);
    });
  });

  describe('ProfilesService visibility rules', () => {
    let service: ProfilesService;
    let mockPrisma: any;

    beforeEach(() => {
      mockPrisma = {
        user: {
          findUnique: jest.fn(),
          findMany: jest.fn(),
          update: jest.fn(),
        },
      };
      service = new ProfilesService(mockPrisma);
    });

    it('hides a 50% specialist profile from anonymous public viewers (404)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'spec-50',
        name: 'Ahmad Khan',
        headline: 'React Developer',
        bio: 'Passionate frontend engineer with 5 years experience.',
        city: 'Lahore',
        role: 'SPECIALIST',
        isDeleted: false,
        avatarUrl: null,
        hourlyRate: null,
        skills: [],
        portfolioItems: [],
      });

      await expect(
        service.getProfileByUserId('spec-50', undefined),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows profile owner to view their own 50% profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'spec-50',
        name: 'Ahmad Khan',
        headline: 'React Developer',
        bio: 'Passionate frontend engineer with 5 years experience.',
        city: 'Lahore',
        role: 'SPECIALIST',
        isDeleted: false,
        avatarUrl: null,
        hourlyRate: null,
        skills: [],
        portfolioItems: [],
      });

      const profile = await service.getProfileByUserId('spec-50', {
        id: 'spec-50',
        role: 'SPECIALIST',
      });
      expect(profile).toBeDefined();
      expect(profile.profileCompletion).toBe(50);
    });

    it('allows admin to view a hidden 50% freelancer profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'spec-50',
        name: 'Ahmad Khan',
        headline: 'React Developer',
        bio: 'Passionate frontend engineer with 5 years experience.',
        city: 'Lahore',
        role: 'SPECIALIST',
        isDeleted: false,
        avatarUrl: null,
        hourlyRate: null,
        skills: [],
        portfolioItems: [],
      });

      const profile = await service.getProfileByUserId('spec-50', {
        id: 'admin-1',
        role: 'ADMIN',
      });
      expect(profile).toBeDefined();
      expect(profile.profileCompletion).toBe(50);
    });

    it('allows public to view a 63% (>50%) specialist profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'spec-63',
        name: 'Ahmad Khan',
        headline: 'React Developer',
        bio: 'Passionate frontend engineer with 5 years experience.',
        city: 'Lahore',
        role: 'SPECIALIST',
        isDeleted: false,
        avatarUrl: null,
        hourlyRate: null,
        skills: ['React', 'TypeScript'],
        portfolioItems: [],
      });

      const profile = await service.getProfileByUserId('spec-63', undefined);
      expect(profile).toBeDefined();
      expect(profile.profileCompletion).toBe(63);
    });

    it('filters out freelancers at or below 50% from searchProfiles', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'user-0',
          role: 'SPECIALIST',
          name: '',
          headline: null,
          bio: null,
          city: null,
          country: null,
          avatarUrl: null,
          skills: [],
          hourlyRate: null,
          portfolioItems: [],
        },
        {
          id: 'user-50',
          role: 'SPECIALIST',
          name: 'Half Complete',
          headline: 'Developer',
          bio: 'Some bio text here',
          city: 'Karachi',
          country: null,
          avatarUrl: null,
          skills: [],
          hourlyRate: null,
          portfolioItems: [],
        },
        {
          id: 'user-63',
          role: 'SPECIALIST',
          name: 'Complete Enough',
          headline: 'Developer',
          bio: 'Some bio text here',
          city: 'Karachi',
          country: null,
          avatarUrl: null,
          skills: ['Node.js'],
          hourlyRate: null,
          portfolioItems: [],
        },
      ]);

      const results = await service.searchProfiles({});
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('user-63');
      expect((results[0] as any).profileCompletion).toBe(63);
    });
  });
});
