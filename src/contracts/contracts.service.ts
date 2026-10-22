import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContractDto } from './dto/contract.dto';
import { ContractStatus, MilestoneStatus } from '@prisma/client';

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async createContract(clientId: string, dto: CreateContractDto) {
    const job = await this.prisma.job.findUnique({ where: { id: dto.jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.clientId !== clientId)
      throw new ForbiddenException('Only job creator can initiate contract');

    const specialist = await this.prisma.user.findUnique({
      where: { id: dto.specialistId },
    });
    if (!specialist) throw new NotFoundException('Specialist user not found');

    const existingContract = await this.prisma.contract.findFirst({
      where: { jobId: dto.jobId, specialistId: dto.specialistId },
      include: { milestones: true, escrow: true },
    });

    if (existingContract) {
      return this.findOne(existingContract.id);
    }

    const milestonesData = (dto.milestones && dto.milestones.length > 0)
      ? dto.milestones.map((m) => ({
          title: m.title,
          description: m.description,
          amount: m.amount,
        }))
      : [{
          title: `Milestone 1: ${job.title}`,
          description: `Initial deliverables for ${job.title}`,
          amount: Number(job.budget) || 10000,
        }];

    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.create({
        data: {
          jobId: dto.jobId,
          clientId,
          specialistId: dto.specialistId,
          status: ContractStatus.DRAFT,
          milestones: {
            create: milestonesData,
          },
        },
        include: { milestones: true },
      });

      // Create empty Escrow instance linked to contract & user
      await tx.escrow.create({
        data: {
          contractId: contract.id,
          userId: clientId,
          balance: 0,
        },
      });

      return contract;
    });
  }

  async fundContract(contractId: string, clientId: string, amount: number) {
    if (!amount || amount <= 0) {
      throw new BadRequestException('Funding amount must be greater than zero');
    }

    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { escrow: true, client: true, specialist: true },
    });

    if (!contract) throw new NotFoundException('Contract not found');
    const user = await this.prisma.user.findUnique({ where: { id: clientId } });
    const isClient =
      contract.clientId === clientId ||
      (contract.client &&
        user &&
        contract.client.email &&
        user.email &&
        contract.client.email.toLowerCase() === user.email.toLowerCase()) ||
      (user && user.role === 'ADMIN');

    if (!isClient)
      throw new ForbiddenException('Only client can fund this contract');

    // 1. Verify client's confirmed available wallet balance
    let clientWallet = await this.prisma.wallet.findFirst({
      where: { userId: clientId },
    });
    if (!clientWallet) {
      clientWallet = await this.prisma.wallet.create({
        data: { userId: clientId, balance: 0, lockedBalance: 0 },
      });
    }

    const availableBalance =
      Number(clientWallet.balance) - Number(clientWallet.lockedBalance || 0);

    if (availableBalance < amount) {
      throw new BadRequestException(
        `Insufficient available wallet funds. Required: PKR ${amount.toLocaleString()}, Available: PKR ${Math.max(0, availableBalance).toLocaleString()}. Please deposit funds into your Paklance wallet first.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 2. Atomically debit amount from client available wallet
      await tx.wallet.update({
        where: { id: clientWallet.id },
        data: { balance: { decrement: amount } },
      });

      // 3. Durable audit record in client's wallet transactions
      const txRef = `ESC-${Date.now().toString().slice(-6)}`;
      await tx.walletTransaction.create({
        data: {
          walletId: clientWallet.id,
          amount: -amount,
          type: 'ESCROW_FUNDING',
          referenceId: txRef,
          description: `SafePay escrow funding for contract #${contract.id.slice(0, 8)}`,
        },
      });

      // 4. Atomically credit the contract's escrow account
      const updatedEscrow = await tx.escrow.update({
        where: { contractId },
        data: {
          balance: { increment: amount },
        },
      });

      // 5. Auditable double-entry ledger record
      await tx.ledgerEntry.create({
        data: {
          escrowId: updatedEscrow.id,
          sourceWalletId: clientWallet.id,
          destinationWalletId: updatedEscrow.id,
          amount,
          status: 'COMPLETED',
        },
      });

      const firstPendingMilestone = await tx.milestone.findFirst({
        where: { contractId, status: MilestoneStatus.PENDING },
        orderBy: { createdAt: 'asc' },
      });
      if (firstPendingMilestone) {
        await tx.milestone.update({
          where: { id: firstPendingMilestone.id },
          data: { status: MilestoneStatus.FUNDED },
        });
      }

      const updatedContract = await tx.contract.update({
        where: { id: contractId },
        data: { status: ContractStatus.FUNDED },
        include: { escrow: true, milestones: true },
      });

      // 6. Notify specialist that escrow is funded and work can begin safely
      if (tx.notification?.create) {
        await tx.notification.create({
          data: {
            userId: contract.specialistId,
            type: 'ESCROW_FUNDED',
            message: `Client funded PKR ${amount.toLocaleString()} in SafePay escrow for contract #${contract.id.slice(0, 8)}. You may safely begin work!`,
          },
        }).catch(() => {});
      }

      return updatedContract;
    });
  }

  async releaseMilestone(milestoneId: string, clientId: string) {
    const milestone = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        contract: {
          include: { escrow: true, client: true, specialist: true },
        },
      },
    });

    if (!milestone) throw new NotFoundException('Milestone not found');
    const user = await this.prisma.user.findUnique({ where: { id: clientId } });
    const isClient =
      milestone.contract.clientId === clientId ||
      (milestone.contract.client &&
        user &&
        milestone.contract.client.email &&
        user.email &&
        milestone.contract.client.email.toLowerCase() ===
          user.email.toLowerCase()) ||
      (user && user.role === 'ADMIN');

    if (!isClient)
      throw new ForbiddenException('Only client can release milestone funds');

    if (milestone.status === MilestoneStatus.RELEASED) {
      throw new BadRequestException('Milestone has already been released');
    }

    const escrow = milestone.contract.escrow;
    if (!escrow || Number(escrow.balance) < Number(milestone.amount)) {
      throw new BadRequestException(
        'Insufficient funds in contract Escrow to release milestone',
      );
    }

    // Platform policy: 10% specialist service fee deducted upon milestone release
    const grossAmount = Number(milestone.amount);
    const platformFee = Math.round(grossAmount * 0.10);
    const netAmount = Math.max(0, grossAmount - platformFee);

    return this.prisma.$transaction(async (tx) => {
      // 1. Deduct escrow balance
      const updatedEscrow = await tx.escrow.update({
        where: { id: escrow.id },
        data: { balance: { decrement: grossAmount } },
      });

      // 2. Find or create Specialist Wallet and increment available balance with NET earnings
      let specialistWallet = await tx.wallet.findFirst({
        where: { userId: milestone.contract.specialistId },
      });
      if (!specialistWallet) {
        specialistWallet = await tx.wallet.create({
          data: { userId: milestone.contract.specialistId, balance: 0, lockedBalance: 0 },
        });
      }

      await tx.wallet.update({
        where: { id: specialistWallet.id },
        data: { balance: { increment: netAmount } },
      });

      // 3. Record WalletTransaction for Specialist with clear breakdown of fee & net
      const txRef = `REL-${Date.now().toString().slice(-6)}`;
      await tx.walletTransaction.create({
        data: {
          walletId: specialistWallet.id,
          amount: netAmount,
          fee: platformFee,
          type: 'MILESTONE_RELEASE',
          referenceId: txRef,
          description: `Milestone release: ${milestone.title} (Gross: PKR ${grossAmount.toLocaleString()}, 10% platform fee: PKR ${platformFee.toLocaleString()}, Net: PKR ${netAmount.toLocaleString()})`,
        },
      });

      // 4. Log immutable double-entry ledger entry
      await tx.ledgerEntry.create({
        data: {
          escrowId: escrow.id,
          sourceWalletId: escrow.id,
          destinationWalletId: specialistWallet.id,
          amount: netAmount,
          status: 'COMPLETED',
        },
      });

      // 5. Mark milestone RELEASED
      const updatedMilestone = await tx.milestone.update({
        where: { id: milestoneId },
        data: {
          status: MilestoneStatus.RELEASED,
          releasedAt: new Date(),
        },
      });

      // 6. Check if all milestones are released -> Contract COMPLETED
      const remainingUnreleased = await tx.milestone.count({
        where: {
          contractId: milestone.contractId,
          id: { not: milestoneId },
          status: { not: MilestoneStatus.RELEASED },
        },
      });
      if (remainingUnreleased === 0) {
        await tx.contract.update({
          where: { id: milestone.contractId },
          data: { status: ContractStatus.COMPLETED },
        });
      }

      // 7. Send audit notifications
      if (tx.notification?.create) {
        await tx.notification.create({
          data: {
            userId: milestone.contract.specialistId,
            type: 'PAYMENT_RELEASED',
            message: `Payment released! PKR ${netAmount.toLocaleString()} has been added to your available wallet balance for milestone: ${milestone.title} (Gross: PKR ${grossAmount.toLocaleString()}, Fee: PKR ${platformFee.toLocaleString()}).`,
          },
        }).catch(() => {});

        await tx.notification.create({
          data: {
            userId: milestone.contract.clientId,
            type: 'MILESTONE_APPROVED',
            message: `Milestone "${milestone.title}" approved and PKR ${grossAmount.toLocaleString()} released from SafePay escrow.`,
          },
        }).catch(() => {});
      }

      return {
        milestone: updatedMilestone,
        remainingEscrowBalance: updatedEscrow.balance,
        netAmount,
        platformFee,
      };
    });
  }

  async submitMilestone(
    contractId: string,
    milestoneId: string,
    specialistId: string,
    dto?: { deliverableNote?: string; deliverableUrls?: string[] },
  ) {
    const milestone = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        contract: {
          include: { specialist: true, client: true },
        },
      },
    });
    if (!milestone) throw new NotFoundException('Milestone not found');
    const user = await this.prisma.user.findUnique({
      where: { id: specialistId },
    });
    const isSpec =
      milestone.contract.specialistId === specialistId ||
      (milestone.contract.specialist &&
        user &&
        milestone.contract.specialist.email &&
        user.email &&
        milestone.contract.specialist.email.toLowerCase() ===
          user.email.toLowerCase()) ||
      (user && user.role === 'ADMIN');

    if (!isSpec) {
      throw new ForbiddenException(
        'Only the assigned specialist can submit milestone work',
      );
    }

    if (
      milestone.status !== MilestoneStatus.FUNDED &&
      milestone.status !== MilestoneStatus.REVISION_REQUESTED
    ) {
      throw new BadRequestException(
        `Cannot submit work for milestone in status ${milestone.status}. Must be FUNDED or REVISION_REQUESTED.`,
      );
    }

    const updatedMilestone = await this.prisma.milestone.update({
      where: { id: milestoneId },
      data: {
        status: MilestoneStatus.SUBMITTED,
        deliverableNote: dto?.deliverableNote || 'Deliverables submitted for client review',
        deliverableUrls: dto?.deliverableUrls || [],
        submittedAt: new Date(),
      },
    });

    await this.prisma.contract.update({
      where: { id: milestone.contractId },
      data: { status: ContractStatus.IN_PROGRESS },
    });

    // Notify client that work is ready for review
    if (this.prisma.notification?.create) {
      await this.prisma.notification.create({
        data: {
          userId: milestone.contract.clientId,
          type: 'WORK_SUBMITTED',
          message: `Specialist has submitted deliverables for milestone "${milestone.title}". Please review and approve or request revisions.`,
        },
      }).catch(() => {});
    }

    return updatedMilestone;
  }

  async requestRevision(
    contractId: string,
    milestoneId: string,
    clientId: string,
    dto: { reason: string },
  ) {
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('Please provide a reason or instructions for the revision request');
    }

    const milestone = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        contract: {
          include: { client: true, specialist: true },
        },
      },
    });
    if (!milestone) throw new NotFoundException('Milestone not found');
    const user = await this.prisma.user.findUnique({ where: { id: clientId } });
    const isClient =
      milestone.contract.clientId === clientId ||
      (milestone.contract.client &&
        user &&
        milestone.contract.client.email &&
        user.email &&
        milestone.contract.client.email.toLowerCase() ===
          user.email.toLowerCase()) ||
      (user && user.role === 'ADMIN');

    if (!isClient) {
      throw new ForbiddenException('Only the client can request revisions');
    }

    if (milestone.status !== MilestoneStatus.SUBMITTED) {
      throw new BadRequestException('Revisions can only be requested after work is submitted');
    }

    // Revision requests MUST NOT release funds: escrow funds remain 100% held
    const updatedMilestone = await this.prisma.milestone.update({
      where: { id: milestoneId },
      data: {
        status: MilestoneStatus.REVISION_REQUESTED,
        revisionNote: dto.reason.trim(),
        revisionCount: { increment: 1 },
      },
    });

    if (this.prisma.notification?.create) {
      await this.prisma.notification.create({
        data: {
          userId: milestone.contract.specialistId,
          type: 'REVISION_REQUESTED',
          message: `Client requested revisions on milestone "${milestone.title}": ${dto.reason.trim()}`,
        },
      }).catch(() => {});
    }

    return updatedMilestone;
  }

  async approveMilestone(
    contractId: string,
    milestoneId: string,
    clientId: string,
  ) {
    return this.releaseMilestone(milestoneId, clientId);
  }

  async findUserContracts(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const isAdmin = user && user.role === 'ADMIN';

    const whereClause: any = isAdmin
      ? {}
      : {
          OR: [
            { clientId: userId },
            { specialistId: userId },
            user?.email ? { client: { email: user.email } } : undefined,
            user?.email ? { specialist: { email: user.email } } : undefined,
          ].filter(Boolean),
        };

    const contracts = await this.prisma.contract.findMany({
      where: whereClause,
      include: {
        job: {
          include: {
            Proposal: {
              where: { status: 'ACCEPTED' },
            },
          },
        },
        client: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
          },
        },
        specialist: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            headline: true,
            avatarUrl: true,
          },
        },
        milestones: { orderBy: { createdAt: 'asc' } },
        escrow: true,
        files: {
          include: {
            uploader: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    for (const c of contracts) {
      if (!c.escrow || !c.milestones || c.milestones.length === 0) {
        const healed = await this.prisma.$transaction(async (tx) => {
          return this.autoHealContractRecords(
            tx,
            c.id,
            c.clientId,
            c.job?.title,
            Number(c.job?.budget) || 10000,
          );
        });
        c.escrow = healed.escrow;
        c.milestones = healed.milestones;
      }
    }

    return contracts;
  }

  async findOne(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        job: true,
        client: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
          },
        },
        specialist: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            headline: true,
            avatarUrl: true,
          },
        },
        milestones: true,
        escrow: true,
        files: {
          include: {
            uploader: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!contract) throw new NotFoundException('Contract not found');

    if (!contract.escrow || !contract.milestones || contract.milestones.length === 0) {
      const healed = await this.prisma.$transaction(async (tx) => {
        return this.autoHealContractRecords(
          tx,
          contract.id,
          contract.clientId,
          contract.job?.title,
          Number(contract.job?.budget) || 10000,
        );
      });
      contract.escrow = healed.escrow;
      contract.milestones = healed.milestones;
    }

    return contract;
  }

  private async autoHealContractRecords(
    tx: any,
    contractId: string,
    clientId: string,
    jobTitle?: string,
    jobBudget?: number,
  ) {
    let escrow = await tx.escrow.findUnique({ where: { contractId } });
    if (!escrow) {
      try {
        escrow = await tx.escrow.create({
          data: { contractId, userId: clientId, balance: 0 },
        });
      } catch (err) {
        escrow = await tx.escrow.findUnique({ where: { contractId } });
      }
    }

    const existingMilestones = await tx.milestone.findMany({
      where: { contractId },
      orderBy: { createdAt: 'asc' },
    });

    let milestones = existingMilestones;
    if (!existingMilestones || existingMilestones.length === 0) {
      const defaultMilestone = await tx.milestone.create({
        data: {
          contractId,
          title: `Milestone 1: ${jobTitle || 'Project Deliverables'}`,
          description: `Delivery for ${jobTitle || 'contract'}`,
          amount: jobBudget || 10000,
        },
      });
      milestones = [defaultMilestone];
    }

    return { escrow, milestones };
  }

  async getContractFiles(userId: string, contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    const isParticipant =
      contract.clientId === userId || contract.specialistId === userId;
    if (!isParticipant) {
      throw new ForbiddenException(
        'You do not have permission to view files for this contract',
      );
    }

    return this.prisma.contractFile.findMany({
      where: { contractId },
      include: {
        uploader: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async uploadContractFile(
    userId: string,
    contractId: string,
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer?: Buffer;
      fileData?: string;
    },
  ) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    const isParticipant =
      contract.clientId === userId || contract.specialistId === userId;
    if (!isParticipant) {
      throw new ForbiddenException(
        'You do not have permission to upload files for this contract',
      );
    }

    const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB (safe for serverless transport)
    const fileSize = Number(file.size) || 0;
    if (fileSize > MAX_FILE_SIZE) {
      throw new BadRequestException('File exceeds maximum allowed size of 3MB');
    }

    const allowedExtensions = [
      '.pdf',
      '.doc',
      '.docx',
      '.txt',
      '.zip',
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
    ];
    const originalName = file.originalname || 'document.pdf';
    const ext = originalName.toLowerCase();
    const isAllowed = allowedExtensions.some((allowed) => ext.endsWith(allowed));
    if (!isAllowed) {
      throw new BadRequestException(
        'Invalid file type. Allowed formats: PDF, DOCX, DOC, TXT, ZIP, PNG, JPG, JPEG, WEBP',
      );
    }

    let fileData = file.fileData;
    if (!fileData && file.buffer) {
      fileData = `data:${file.mimetype || 'application/octet-stream'};base64,${file.buffer.toString('base64')}`;
    }
    if (!fileData) {
      throw new BadRequestException('File content cannot be empty');
    }

    const safeFilename = `${Date.now()}_${originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    return this.prisma.contractFile.create({
      data: {
        contractId,
        uploaderId: userId,
        filename: safeFilename,
        originalName,
        fileSize,
        mimeType: file.mimetype || 'application/octet-stream',
        fileData,
      },
      include: {
        uploader: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });
  }

  async getContractFile(userId: string, contractId: string, fileId: string) {
    const file = await this.prisma.contractFile.findUnique({
      where: { id: fileId },
      include: { contract: true },
    });
    if (!file || file.contractId !== contractId) {
      throw new NotFoundException('File not found');
    }

    const isParticipant =
      file.contract.clientId === userId ||
      file.contract.specialistId === userId;
    if (!isParticipant) {
      throw new ForbiddenException(
        'You do not have permission to access this contract file',
      );
    }

    return file;
  }

  async startContract(contractId: string, specialistId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    if (contract.specialistId !== specialistId) {
      throw new ForbiddenException(
        'Only the specialist can start the contract',
      );
    }
    if (contract.status !== ContractStatus.FUNDED) {
      throw new BadRequestException(
        'Contract must be FUNDED before it can be started',
      );
    }
    return this.prisma.contract.update({
      where: { id: contractId },
      data: { status: ContractStatus.IN_PROGRESS },
    });
  }

  async completeContract(contractId: string, clientId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    if (contract.clientId !== clientId) {
      throw new ForbiddenException(
        'Only the client can mark the contract as complete',
      );
    }
    if (contract.status !== ContractStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Contract must be IN_PROGRESS to be marked as completed',
      );
    }
    return this.prisma.contract.update({
      where: { id: contractId },
      data: { status: ContractStatus.COMPLETED },
    });
  }

  async closeContract(contractId: string, userId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    const isParticipant =
      contract.clientId === userId || contract.specialistId === userId;
    if (!isParticipant)
      throw new ForbiddenException(
        'You are not a participant in this contract',
      );
    const closableStatuses: ContractStatus[] = [
      ContractStatus.COMPLETED,
      ContractStatus.DISPUTED,
    ];
    if (!closableStatuses.includes(contract.status)) {
      throw new BadRequestException(
        'Contract can only be closed after it is COMPLETED or DISPUTED',
      );
    }
    return this.prisma.contract.update({
      where: { id: contractId },
      data: { status: ContractStatus.CLOSED },
    });
  }
}
