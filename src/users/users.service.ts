import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Role,
  User,
  ContractStatus,
  DisputeStatus,
  ProposalStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    email: string;
    password: string;
    role?: Role;
    isEmailVerified?: boolean;
    emailVerifyOtp?: string;
    emailVerifyExpires?: Date;
    emailVerifyLastSentAt?: Date;
  }): Promise<Omit<User, 'passwordHash'>> {
    await this.prisma.ensureSchemaMigrated?.();
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    let user: any;
    try {
      user = await this.prisma.user.create({
        data: {
          email: data.email,
          passwordHash,
          role: data.role || Role.SPECIALIST,
          isEmailVerified: data.isEmailVerified ?? false,
          emailVerifyOtp: data.emailVerifyOtp,
          emailVerifyExpires: data.emailVerifyExpires,
          emailVerifyLastSentAt: data.emailVerifyLastSentAt,
        },
      });
    } catch (createErr: any) {
      if (createErr?.code === 'P2002' || createErr instanceof ConflictException) {
        throw new ConflictException('User with this email already exists');
      }
      try {
        user = await this.prisma.user.create({
          data: {
            email: data.email,
            passwordHash,
            role: data.role || Role.SPECIALIST,
          },
        });
      } catch (fallbackErr: any) {
        throw createErr;
      }
    }

    const { passwordHash: _, ...result } = user;
    return result;
  }

  async findAll() {
    return this.prisma.user.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        isDeleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user || (user as any).isDeleted) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(email: string) {
    await this.prisma.ensureSchemaMigrated?.();
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async update(
    id: string,
    data: { email?: string; role?: Role; password?: string },
  ) {
    await this.findOne(id);

    const updateData: any = {};
    if (data.email) updateData.email = data.email;
    if (data.role) updateData.role = data.role;
    if (data.password) {
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async deleteUser(
    targetId: string,
    options: { isSelf: boolean; adminId?: string; password?: string },
  ) {
    await this.prisma.ensureSchemaMigrated?.();

    // 1. Validate target user exists
    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
    });
    if (!user || (user as any).isDeleted) {
      throw new NotFoundException('User not found or account is already deleted');
    }

    // 2. Authorization rules
    if (options.isSelf) {
      throw new ForbiddenException(
        'Self-service account deletion has been disabled. Please contact Paklance support or an administrator to request account removal.',
      );
    } else {
      if (options.adminId && options.adminId === targetId) {
        throw new BadRequestException(
          'Administrators cannot delete their own account from the Admin Console.',
        );
      }
      if (user.role === Role.ADMIN) {
        throw new ForbiddenException(
          'Administrator accounts cannot be deleted.',
        );
      }
    }

    // 3. Protection for Active Contracts
    const activeContract = await this.prisma.contract.findFirst({
      where: {
        OR: [{ clientId: targetId }, { specialistId: targetId }],
        status: {
          in: [
            ContractStatus.FUNDED,
            ContractStatus.IN_PROGRESS,
            ContractStatus.DISPUTED,
          ],
        },
      },
    });
    if (activeContract) {
      throw new BadRequestException(
        options.isSelf
          ? 'You cannot delete your account while you have active contracts. Please complete or cancel all active contracts first.'
          : 'Cannot delete user with active contracts. Active contracts must be resolved or completed first.',
      );
    }

    // 4. Protection for Wallets, Locked Balances & Pending Escrow
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId: targetId },
    });
    if (wallet) {
      const balance = Number(wallet.balance) || 0;
      const locked = Number(wallet.lockedBalance) || 0;
      if (balance > 0 || locked > 0) {
        throw new BadRequestException(
          options.isSelf
            ? `Your wallet currently has a balance of PKR ${balance.toLocaleString()} (Locked: PKR ${locked.toLocaleString()}). Please withdraw your funds before deleting your account.`
            : `Cannot delete user with active wallet funds (Balance: PKR ${balance}, Locked: PKR ${locked}).`,
        );
      }
    }

    // 5. Protection for Pending Withdrawals
    const pendingWithdrawal = await this.prisma.withdrawalRequest.findFirst({
      where: {
        userId: targetId,
        status: { in: ['REQUESTED', 'PROCESSING'] },
      },
    });
    if (pendingWithdrawal) {
      throw new BadRequestException(
        options.isSelf
          ? 'You have a pending withdrawal request in process. Please wait for it to complete.'
          : 'Cannot delete user with pending withdrawal requests.',
      );
    }

    // 6. Protection for Open Disputes
    const openDispute = await this.prisma.dispute.findFirst({
      where: {
        raisedByUserId: targetId,
        status: DisputeStatus.OPEN,
      },
    });
    if (openDispute) {
      throw new BadRequestException(
        options.isSelf
          ? 'You have an open dispute under review. Please resolve the dispute first.'
          : 'Cannot delete user with open or pending disputes.',
      );
    }

    // 7. Check if user has historical records (completed contracts, payments)
    const [contractCount, paymentCount] = await Promise.all([
      this.prisma.contract.count({
        where: { OR: [{ clientId: targetId }, { specialistId: targetId }] },
      }),
      this.prisma.payment.count({
        where: { userId: targetId },
      }),
    ]);

    const hasFinancialHistory = contractCount > 0 || paymentCount > 0;

    if (hasFinancialHistory) {
      // Soft-delete & Anonymize
      await this.prisma.$transaction(async (tx) => {
        await tx.job.updateMany({
          where: { clientId: targetId, status: 'OPEN' },
          data: { status: 'CANCELLED' },
        });
        await tx.proposal.updateMany({
          where: { freelancerId: targetId, status: ProposalStatus.PENDING },
          data: { status: ProposalStatus.WITHDRAWN },
        });
        await tx.portfolioItem.deleteMany({ where: { userId: targetId } });
        await tx.verification.deleteMany({ where: { userId: targetId } });
        await tx.pushSubscription.deleteMany({ where: { userId: targetId } });
        await tx.user.update({
          where: { id: targetId },
          data: {
            isDeleted: true,
            deletedAt: new Date(),
            email: `deleted_${targetId.slice(0, 8)}_${Date.now()}@deleted.paklance.com`,
            name: 'Deactivated User',
            passwordHash: 'DEACTIVATED_ACCOUNT_' + Date.now(),
            bio: null,
            headline: null,
            avatarUrl: null,
            videoUrl: null,
            videoName: null,
            videoSize: null,
            skills: [],
            availability: 'UNAVAILABLE' as any,
            resetPasswordToken: null,
            resetPasswordExpires: null,
            emailVerifyOtp: null,
          },
        });
      });

      return {
        success: true,
        method: 'soft_delete',
        message: 'Account deactivated and personal data anonymized successfully.',
      };
    } else {
      // Safe Hard-Delete in transaction
      await this.prisma.$transaction(async (tx) => {
        await tx.portfolioItem.deleteMany({ where: { userId: targetId } });
        await tx.verification.deleteMany({ where: { userId: targetId } });
        await tx.pushSubscription.deleteMany({ where: { userId: targetId } });
        await tx.notification.deleteMany({ where: { userId: targetId } });
        await tx.payoutMethod.deleteMany({ where: { userId: targetId } });
        await tx.proposal.deleteMany({ where: { freelancerId: targetId } });
        await tx.job.deleteMany({ where: { clientId: targetId } });
        await tx.wallet.deleteMany({ where: { userId: targetId } });
        await tx.contractFile.deleteMany({ where: { uploaderId: targetId } });
        await tx.review.deleteMany({
          where: { OR: [{ reviewerId: targetId }, { revieweeId: targetId }] },
        });
        await tx.user.delete({ where: { id: targetId } });
      });

      return {
        success: true,
        method: 'hard_delete',
        message: 'Account deleted completely.',
      };
    }
  }

  async remove(id: string) {
    return this.deleteUser(id, { isSelf: false });
  }
}
