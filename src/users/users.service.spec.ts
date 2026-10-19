import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

describe('UsersService - Account Deletion', () => {
  let service: UsersService;
  let prisma: any;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    contract: {
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    wallet: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    withdrawalRequest: {
      findFirst: jest.fn(),
    },
    dispute: {
      findFirst: jest.fn(),
    },
    payment: {
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    profile: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    portfolioItem: {
      deleteMany: jest.fn(),
    },
    verification: {
      deleteMany: jest.fn(),
    },
    pushSubscription: {
      deleteMany: jest.fn(),
    },
    payoutMethod: {
      deleteMany: jest.fn(),
    },
    contractFile: {
      deleteMany: jest.fn(),
    },
    kycVerification: {
      deleteMany: jest.fn(),
    },
    notification: {
      deleteMany: jest.fn(),
    },
    job: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    proposal: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    review: {
      deleteMany: jest.fn(),
    },
    message: {
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.contract.count.mockResolvedValue(0);
    mockPrisma.payment.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('throws NotFoundException if user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.deleteUser('missing-user', { adminId: 'admin-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException if user is already deleted', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'deleted-user',
      isDeleted: true,
    });
    await expect(
      service.deleteUser('deleted-user', { adminId: 'admin-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('strictly rejects self-service deletion with ForbiddenException', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'SPECIALIST',
      isDeleted: false,
    });

    await expect(
      service.deleteUser('user-1', {
        isSelf: true,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('prevents admin from deleting their own account in admin console', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      role: 'ADMIN',
      isDeleted: false,
    });

    await expect(
      service.deleteUser('admin-1', { adminId: 'admin-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('prevents deleting another administrator account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'admin-2',
      role: 'ADMIN',
      isDeleted: false,
    });

    await expect(
      service.deleteUser('admin-2', { adminId: 'admin-1' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('prevents deleting an account with active contracts', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-contract',
      passwordHash: null,
      role: 'SPECIALIST',
      isDeleted: false,
    });
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c-1', status: 'IN_PROGRESS' });

    await expect(
      service.deleteUser('user-contract', { adminId: 'admin-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('prevents deleting an account with positive wallet balance', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-wallet',
      passwordHash: null,
      role: 'SPECIALIST',
      isDeleted: false,
    });
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    mockPrisma.wallet.findFirst.mockResolvedValue({
      id: 'w-1',
      balance: 1500,
      lockedBalance: 0,
    });

    await expect(
      service.deleteUser('user-wallet', { adminId: 'admin-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('prevents deleting an account with open disputes', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-dispute',
      passwordHash: null,
      role: 'CLIENT',
      isDeleted: false,
    });
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'w-1', balance: 0, lockedBalance: 0 });
    mockPrisma.withdrawalRequest.findFirst.mockResolvedValue(null);
    mockPrisma.dispute.findFirst.mockResolvedValue({ id: 'd-1', status: 'OPEN' });

    await expect(
      service.deleteUser('user-dispute', { adminId: 'admin-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('soft deletes user and anonymizes personal data if historical financial records exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-history',
      email: 'history@test.com',
      name: 'John Doe',
      passwordHash: 'hashed',
      role: 'SPECIALIST',
      isDeleted: false,
    });
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'w-1', balance: 0, lockedBalance: 0 });
    mockPrisma.withdrawalRequest.findFirst.mockResolvedValue(null);
    mockPrisma.dispute.findFirst.mockResolvedValue(null);
    // Has a past payment record
    mockPrisma.payment.count.mockResolvedValue(1);
    mockPrisma.user.update.mockResolvedValue({ id: 'user-history', isDeleted: true });

    const result = await service.deleteUser('user-history', {
      adminId: 'admin-1',
    });

    expect(result.method).toBe('soft_delete');
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-history' },
        data: expect.objectContaining({
          isDeleted: true,
          name: 'Deactivated User',
        }),
      }),
    );
  });

  it('hard deletes clean test user with no financial history via admin console', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-clean-test',
      email: 'clean@test.com',
      name: 'Test Account',
      passwordHash: 'hashed',
      role: 'SPECIALIST',
      isDeleted: false,
    });
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    mockPrisma.wallet.findFirst.mockResolvedValue(null);
    mockPrisma.withdrawalRequest.findFirst.mockResolvedValue(null);
    mockPrisma.dispute.findFirst.mockResolvedValue(null);
    mockPrisma.contract.count.mockResolvedValue(0);
    mockPrisma.payment.count.mockResolvedValue(0);

    const result = await service.deleteUser('user-clean-test', {
      adminId: 'admin-1',
    });

    expect(result.method).toBe('hard_delete');
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({
      where: { id: 'user-clean-test' },
    });
  });

  describe('searchUsers', () => {
    it('searches users by name or email, excludes requesting user, and formats results safely', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'client-1',
          name: 'Ahmed Khan',
          email: 'ahmed@client.com',
          role: 'CLIENT',
          headline: 'Client Account',
          avatarUrl: null,
        },
        {
          id: 'spec-1',
          name: 'Sara Specialist',
          email: 'sara@freelancer.com',
          role: 'SPECIALIST',
          headline: 'Full Stack Engineer',
          avatarUrl: 'https://example.com/sara.jpg',
        },
      ]);

      const results = await service.searchUsers('req-user-id', 'Ahmed');
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        id: 'client-1',
        name: 'Ahmed Khan',
        email: 'ahmed@client.com',
        role: 'Client',
        rawRole: 'CLIENT',
        headline: 'Client Account',
        avatarUrl: null,
        accountType: 'Client',
      });
      expect(results[1]).toEqual({
        id: 'spec-1',
        name: 'Sara Specialist',
        email: 'sara@freelancer.com',
        role: 'Specialist / Freelancer',
        rawRole: 'SPECIALIST',
        headline: 'Full Stack Engineer',
        avatarUrl: 'https://example.com/sara.jpg',
        accountType: 'Specialist/Freelancer',
      });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          isDeleted: false,
          id: { not: 'req-user-id' },
          OR: [
            { name: { contains: 'Ahmed', mode: 'insensitive' } },
            { email: { contains: 'Ahmed', mode: 'insensitive' } },
            { headline: { contains: 'Ahmed', mode: 'insensitive' } },
          ],
        },
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          headline: true,
          avatarUrl: true,
        },
      });
    });
  });
});

