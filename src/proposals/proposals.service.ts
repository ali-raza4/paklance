import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { UpdateProposalStatusDto } from './dto/update-proposal-status.dto';

@Injectable()
export class ProposalsService {
  constructor(private readonly prisma: PrismaService) {}

  async submitProposal(freelancerId: string, dto: CreateProposalDto) {
    const job = await this.prisma.job.findUnique({ where: { id: dto.jobId } });
    if (!job) throw new NotFoundException('Job not found');

    const existing = await this.prisma.proposal.findFirst({
      where: { jobId: dto.jobId, freelancerId, status: 'PENDING' },
    });
    if (existing)
      throw new BadRequestException(
        'You already have a pending proposal for this job',
      );

    return this.prisma.proposal.create({
      data: {
        jobId: dto.jobId,
        freelancerId,
        coverLetter: dto.coverLetter,
        bidAmount: dto.bidAmount,
        deliveryDays: dto.deliveryDays,
      },
    });
  }

  async getProposalsByJob(userId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { client: { select: { id: true, email: true } } },
    });
    if (!job) throw new NotFoundException('Job not found');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const isAdmin = user && user.role === 'ADMIN';
    const isOwner =
      job.clientId === userId ||
      (job.client &&
        user &&
        job.client.email &&
        user.email &&
        job.client.email.toLowerCase() === user.email.toLowerCase());
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Only the job owner can view proposals');
    }

    return this.prisma.proposal.findMany({
      where: { jobId },
      include: {
        User: {
          select: {
            id: true,
            name: true,
            email: true,
            headline: true,
            city: true,
            country: true,
            avatarUrl: true,
            skills: true,
            hourlyRate: true,
            availability: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getClientProposals(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const isAdmin = user && user.role === 'ADMIN';

    const whereClause: any = isAdmin
      ? {}
      : {
          OR: [
            { job: { clientId: userId } },
            user.email
              ? { job: { client: { email: user.email } } }
              : { job: { clientId: userId } },
          ],
        };

    return this.prisma.proposal.findMany({
      where: whereClause,
      include: {
        job: {
          select: {
            id: true,
            title: true,
            budget: true,
            clientId: true,
          },
        },
        User: {
          select: {
            id: true,
            name: true,
            email: true,
            headline: true,
            city: true,
            country: true,
            avatarUrl: true,
            skills: true,
            hourlyRate: true,
            availability: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyProposals(freelancerId: string) {
    return this.prisma.proposal.findMany({
      where: { freelancerId },
      include: {
        job: {
          select: { id: true, title: true, budget: true, clientId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async verifyJobOwner(userId: string, job: any): Promise<boolean> {
    if (!job) return false;
    if (job.clientId === userId) return true;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return false;
    if (user.role === 'ADMIN') return true;
    if (
      job.client &&
      job.client.email &&
      user.email &&
      job.client.email.toLowerCase() === user.email.toLowerCase()
    ) {
      return true;
    }
    return false;
  }

  async acceptProposal(userId: string, proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: {
        job: { include: { client: { select: { id: true, email: true } } } },
        User: true,
      },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');

    const isOwner = await this.verifyJobOwner(userId, proposal.job);
    if (!isOwner) {
      throw new ForbiddenException(
        'Only the job owner can accept proposals',
      );
    }

    if (proposal.status === 'ACCEPTED') {
      return proposal;
    }

    // Check if another proposal for this job is already accepted
    const existingAccepted = await this.prisma.proposal.findFirst({
      where: {
        jobId: proposal.jobId,
        status: 'ACCEPTED',
        id: { not: proposalId },
      },
    });
    if (existingAccepted) {
      throw new BadRequestException(
        'A proposal has already been accepted for this job',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Mark this proposal as ACCEPTED
      const accepted = await tx.proposal.update({
        where: { id: proposalId },
        data: { status: 'ACCEPTED' },
        include: {
          job: true,
          User: {
            select: {
              id: true,
              name: true,
              email: true,
              headline: true,
              avatarUrl: true,
            },
          },
        },
      });

      // 2. Reject all other pending proposals for this job
      await tx.proposal.updateMany({
        where: {
          jobId: proposal.jobId,
          id: { not: proposalId },
          status: 'PENDING',
        },
        data: { status: 'REJECTED' },
      });

      // 3. Create or link a draft contract if none exists
      const existingContract = await tx.contract.findFirst({
        where: {
          jobId: proposal.jobId,
          specialistId: proposal.freelancerId,
        },
      });

      const effectiveClientId = proposal.job.clientId || userId;

      if (!existingContract) {
        const newContract = await tx.contract.create({
          data: {
            jobId: proposal.jobId,
            clientId: effectiveClientId,
            specialistId: proposal.freelancerId,
            status: 'DRAFT',
            milestones: {
              create: [
                {
                  title: `Milestone 1: ${proposal.job?.title || 'Project Milestone'}`,
                  description: `Delivery within ${proposal.deliveryDays || 7} days - ${String(proposal.coverLetter || '').slice(0, 150)}`,
                  amount: proposal.bidAmount,
                },
              ],
            },
          },
        });

        await tx.escrow.create({
          data: {
            contractId: newContract.id,
            userId: effectiveClientId,
            balance: 0,
          },
        });
      }

      return accepted;
    });
  }

  async rejectProposal(userId: string, proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: {
        job: { include: { client: { select: { id: true, email: true } } } },
      },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');

    const isOwner = await this.verifyJobOwner(userId, proposal.job);
    if (!isOwner) {
      throw new ForbiddenException(
        'Only the job owner can reject proposals',
      );
    }

    return this.prisma.proposal.update({
      where: { id: proposalId },
      data: { status: 'REJECTED' },
    });
  }

  async updateStatus(
    userId: string,
    proposalId: string,
    dto: UpdateProposalStatusDto,
  ) {
    if (dto.status === 'ACCEPTED') {
      return this.acceptProposal(userId, proposalId);
    }
    if (dto.status === 'REJECTED') {
      return this.rejectProposal(userId, proposalId);
    }

    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: {
        job: { include: { client: { select: { id: true, email: true } } } },
      },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');

    const isOwner = await this.verifyJobOwner(userId, proposal.job);
    if (!isOwner) {
      throw new ForbiddenException(
        'Only the job owner can update proposal status',
      );
    }
    return this.prisma.proposal.update({
      where: { id: proposalId },
      data: { status: dto.status },
    });
  }

  async withdrawProposal(freelancerId: string, proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.freelancerId !== freelancerId) {
      throw new ForbiddenException('Not your proposal');
    }
    return this.prisma.proposal.update({
      where: { id: proposalId },
      data: { status: 'WITHDRAWN' },
    });
  }
}
