import { Test, TestingModule } from '@nestjs/testing';
import { ProposalsService } from './proposals.service';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

const mockPrismaService = {
  job: {
    findUnique: jest.fn(),
  },
  proposal: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  contract: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  escrow: {
    create: jest.fn(),
  },
  $transaction: jest.fn((cb) => cb(mockPrismaService)),
};

describe('ProposalsService', () => {
  let service: ProposalsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ProposalsService>(ProposalsService);
  });

  describe('getProposalsByJob', () => {
    it('returns proposals with User details when requested by job client', async () => {
      mockPrismaService.job.findUnique.mockResolvedValue({
        id: 'job-1',
        clientId: 'client-1',
      });
      mockPrismaService.proposal.findMany.mockResolvedValue([
        {
          id: 'prop-1',
          jobId: 'job-1',
          freelancerId: 'spec-1',
          coverLetter: 'I am the best fit',
          bidAmount: 50000,
          deliveryDays: 10,
          status: 'PENDING',
          User: {
            id: 'spec-1',
            name: 'Ali Khan',
            email: 'ali@paklance.com',
            headline: 'Full Stack Engineer',
            city: 'Lahore',
            avatarUrl: null,
            skills: ['React', 'Node.js'],
          },
        },
      ]);

      const result = await service.getProposalsByJob('client-1', 'job-1');

      expect(mockPrismaService.job.findUnique).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        include: {
          client: {
            select: { id: true, email: true },
          },
        },
      });
      expect(result).toHaveLength(1);
      expect(result[0].User.name).toBe('Ali Khan');
    });

    it('throws ForbiddenException if user is not the job client', async () => {
      mockPrismaService.job.findUnique.mockResolvedValue({
        id: 'job-1',
        clientId: 'client-2',
      });

      await expect(
        service.getProposalsByJob('client-1', 'job-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if job is not found', async () => {
      mockPrismaService.job.findUnique.mockResolvedValue(null);

      await expect(
        service.getProposalsByJob('client-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('acceptProposal', () => {
    it('accepts proposal, rejects others, and creates draft contract', async () => {
      mockPrismaService.proposal.findUnique.mockResolvedValue({
        id: 'prop-1',
        jobId: 'job-1',
        freelancerId: 'spec-1',
        status: 'PENDING',
        job: { id: 'job-1', clientId: 'client-1' },
      });
      mockPrismaService.proposal.findFirst.mockResolvedValue(null);
      mockPrismaService.proposal.update.mockResolvedValue({
        id: 'prop-1',
        status: 'ACCEPTED',
        job: { id: 'job-1' },
      });
      mockPrismaService.proposal.updateMany.mockResolvedValue({ count: 2 });
      mockPrismaService.contract.findFirst.mockResolvedValue(null);
      mockPrismaService.contract.create.mockResolvedValue({ id: 'contract-1' });

      const result = await service.acceptProposal('client-1', 'prop-1');

      expect(mockPrismaService.proposal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prop-1' },
          data: { status: 'ACCEPTED' },
        }),
      );
      expect(mockPrismaService.proposal.updateMany).toHaveBeenCalledWith({
        where: {
          jobId: 'job-1',
          id: { not: 'prop-1' },
          status: 'PENDING',
        },
        data: { status: 'REJECTED' },
      });
      expect(mockPrismaService.contract.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            jobId: 'job-1',
            clientId: 'client-1',
            specialistId: 'spec-1',
            status: 'DRAFT',
          }),
        }),
      );
      expect(result.status).toBe('ACCEPTED');
    });

    it('throws ForbiddenException if non-owner tries to accept proposal', async () => {
      mockPrismaService.proposal.findUnique.mockResolvedValue({
        id: 'prop-1',
        jobId: 'job-1',
        freelancerId: 'spec-1',
        status: 'PENDING',
        job: { id: 'job-1', clientId: 'client-other' },
      });

      await expect(
        service.acceptProposal('client-1', 'prop-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('rejectProposal', () => {
    it('marks proposal as REJECTED when called by job client', async () => {
      mockPrismaService.proposal.findUnique.mockResolvedValue({
        id: 'prop-1',
        jobId: 'job-1',
        status: 'PENDING',
        job: { id: 'job-1', clientId: 'client-1' },
      });
      mockPrismaService.proposal.update.mockResolvedValue({
        id: 'prop-1',
        status: 'REJECTED',
      });

      const res = await service.rejectProposal('client-1', 'prop-1');

      expect(mockPrismaService.proposal.update).toHaveBeenCalledWith({
        where: { id: 'prop-1' },
        data: { status: 'REJECTED' },
      });
      expect(res.status).toBe('REJECTED');
    });
  });
});
