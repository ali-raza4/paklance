import { Test, TestingModule } from '@nestjs/testing';
import { ContractsService } from './contracts.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MilestoneStatus, ContractStatus } from '@prisma/client';

describe('ContractsService Escrow & Milestone Lifecycle', () => {
  let service: ContractsService;
  let prisma: any;

  const mockContract = {
    id: 'contract-1',
    clientId: 'client-1',
    specialistId: 'spec-1',
    status: ContractStatus.ACTIVE,
    totalBudget: 10000,
    escrow: {
      id: 'escrow-1',
      contractId: 'contract-1',
      balance: 0,
      totalFunded: 0,
      totalReleased: 0,
    },
    client: {
      id: 'client-1',
      email: 'client@example.com',
    },
    specialist: {
      id: 'spec-1',
      email: 'spec@example.com',
    },
    milestones: [
      {
        id: 'm-1',
        contractId: 'contract-1',
        title: 'Milestone 1',
        amount: 5000,
        status: MilestoneStatus.PENDING,
        revisionCount: 0,
      },
    ],
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 'client-1') return Promise.resolve({ id: 'client-1', email: 'client@example.com', role: 'CLIENT' });
          if (where.id === 'spec-1') return Promise.resolve({ id: 'spec-1', email: 'spec@example.com', role: 'SPECIALIST' });
          return Promise.resolve(null);
        }),
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue(mockContract),
        update: jest.fn().mockResolvedValue({ id: 'contract-1', status: ContractStatus.IN_PROGRESS }),
      },
      milestone: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: 'm-1', amount: 5000 }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({ id: 'm-1' }),
      },
      escrow: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'escrow-1', balance: 0, totalReleased: 5000 }),
      },
      wallet: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'tx-1' }),
      },
      ledgerEntry: {
        create: jest.fn().mockResolvedValue({ id: 'le-1' }),
      },
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
  });

  describe('fundContract', () => {
    it('should reject when user is not the client', async () => {
      await expect(
        service.fundContract('contract-1', 'spec-1', 5000),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject when client has insufficient wallet balance', async () => {
      prisma.wallet.findFirst.mockResolvedValue({
        id: 'w-client',
        userId: 'client-1',
        balance: 3000,
        lockedBalance: 0,
      });

      await expect(
        service.fundContract('contract-1', 'client-1', 5000),
      ).rejects.toThrow(BadRequestException);
    });

    it('should atomically debit client wallet and credit escrow when balance is sufficient', async () => {
      prisma.wallet.findFirst.mockResolvedValue({
        id: 'w-client',
        userId: 'client-1',
        balance: 10000,
        lockedBalance: 0,
      });
      prisma.wallet.update.mockResolvedValue({
        id: 'w-client',
        balance: 5000,
      });
      prisma.escrow.update.mockResolvedValue({
        id: 'escrow-1',
        balance: 5000,
        totalFunded: 5000,
      });

      const result = await service.fundContract('contract-1', 'client-1', 5000);

      expect(prisma.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'w-client' },
          data: { balance: { decrement: 5000 } },
        }),
      );
      expect(prisma.escrow.update).toHaveBeenCalled();
      expect(prisma.milestone.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm-1' },
          data: { status: MilestoneStatus.FUNDED },
        }),
      );
    });
  });

  describe('submitMilestone', () => {
    it('should record deliverables note, URLs, and transition milestone to SUBMITTED', async () => {
      const milestoneWithContract = {
        id: 'm-1',
        contractId: 'contract-1',
        status: MilestoneStatus.FUNDED,
        contract: {
          id: 'contract-1',
          clientId: 'client-1',
          specialistId: 'spec-1',
          title: 'Design Project',
          specialist: { id: 'spec-1', email: 'spec@example.com' },
        },
      };
      prisma.milestone.findUnique.mockResolvedValue(milestoneWithContract);
      prisma.milestone.update.mockResolvedValue({
        id: 'm-1',
        status: MilestoneStatus.SUBMITTED,
        deliverableNote: 'Completed wireframes',
      });

      const result = await service.submitMilestone('contract-1', 'm-1', 'spec-1', {
        deliverableNote: 'Completed wireframes',
        deliverableUrls: ['https://figma.com/file/xyz'],
      });

      expect(prisma.milestone.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm-1' },
          data: expect.objectContaining({
            status: MilestoneStatus.SUBMITTED,
            deliverableNote: 'Completed wireframes',
            deliverableUrls: ['https://figma.com/file/xyz'],
          }),
        }),
      );
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'contract-1' },
          data: { status: ContractStatus.IN_PROGRESS },
        }),
      );
    });

    it('should reject submission from user who is not the specialist', async () => {
      const milestoneWithContract = {
        id: 'm-1',
        contractId: 'contract-1',
        status: MilestoneStatus.FUNDED,
        contract: {
          id: 'contract-1',
          clientId: 'client-1',
          specialistId: 'spec-1',
          specialist: { id: 'spec-1', email: 'spec@example.com' },
        },
      };
      prisma.milestone.findUnique.mockResolvedValue(milestoneWithContract);

      await expect(
        service.submitMilestone('contract-1', 'm-1', 'client-1', { deliverableNote: 'Done' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('requestRevision', () => {
    it('should update milestone to REVISION_REQUESTED and increment revisionCount', async () => {
      const milestoneWithContract = {
        id: 'm-1',
        contractId: 'contract-1',
        status: MilestoneStatus.SUBMITTED,
        revisionCount: 0,
        contract: {
          id: 'contract-1',
          clientId: 'client-1',
          specialistId: 'spec-1',
          title: 'Design Project',
          client: { id: 'client-1', email: 'client@example.com' },
        },
      };
      prisma.milestone.findUnique.mockResolvedValue(milestoneWithContract);
      prisma.milestone.update.mockResolvedValue({
        id: 'm-1',
        status: MilestoneStatus.REVISION_REQUESTED,
        revisionCount: 1,
      });

      const result = await service.requestRevision('contract-1', 'm-1', 'client-1', {
        reason: 'Please change the font and primary color palette.',
      });

      expect(prisma.milestone.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm-1' },
          data: expect.objectContaining({
            status: MilestoneStatus.REVISION_REQUESTED,
            revisionNote: 'Please change the font and primary color palette.',
            revisionCount: { increment: 1 },
          }),
        }),
      );
    });
  });

  describe('releaseMilestone', () => {
    it('should release funds with 10% platform fee and credit net to specialist wallet', async () => {
      const milestoneWithContract = {
        id: 'm-1',
        contractId: 'contract-1',
        amount: 10000,
        status: MilestoneStatus.SUBMITTED,
        contract: {
          id: 'contract-1',
          clientId: 'client-1',
          specialistId: 'spec-1',
          title: 'Full Stack App',
          client: { id: 'client-1', email: 'client@example.com' },
          escrow: {
            id: 'escrow-1',
            balance: 10000,
          },
        },
      };
      prisma.milestone.findUnique.mockResolvedValue(milestoneWithContract);
      prisma.wallet.findFirst.mockResolvedValue({
        id: 'w-spec',
        userId: 'spec-1',
        balance: 0,
      });
      prisma.escrow.update.mockResolvedValue({
        id: 'escrow-1',
        balance: 0,
        totalReleased: 10000,
      });
      prisma.milestone.findMany.mockResolvedValue([
        { id: 'm-1', status: MilestoneStatus.RELEASED },
      ]);
      prisma.milestone.count.mockResolvedValue(0);

      const result = await service.releaseMilestone('m-1', 'client-1');

      // 10,000 * 0.10 = 1000 fee, net = 9000
      expect(prisma.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'w-spec' },
          data: { balance: { increment: 9000 } },
        }),
      );
      expect(prisma.escrow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'escrow-1' },
          data: {
            balance: { decrement: 10000 },
          },
        }),
      );
      expect(prisma.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 9000,
            fee: 1000,
            type: 'MILESTONE_RELEASE',
          }),
        }),
      );
    });
  });
});
