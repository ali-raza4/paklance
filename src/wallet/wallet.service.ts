import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DepositDto } from './dto/deposit.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { PayoutType, WithdrawalStatus } from '@prisma/client';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateWallet(userId: string) {
    let wallet = await this.prisma.wallet.findFirst({ where: { userId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { userId, balance: 0, lockedBalance: 0 },
      });
    }
    return wallet;
  }

  async getBalance(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    const balance = Number(wallet.balance);
    const lockedBalance = Number(wallet.lockedBalance || 0);
    const availableBalance = Math.max(0, balance - lockedBalance);

    return {
      balance,
      lockedBalance,
      availableBalance,
    };
  }

  /**
   * Role-specific wallet summary:
   * Returns distinct, audited metrics for CLIENT vs SPECIALIST
   */
  async getSummary(userId: string, userRole: string) {
    const wallet = await this.getOrCreateWallet(userId);
    const balance = Number(wallet.balance);
    const lockedBalance = Number(wallet.lockedBalance || 0);
    const availableBalance = Math.max(0, balance - lockedBalance);

    const isClient = String(userRole || '').toUpperCase() === 'CLIENT';

    if (isClient) {
      // 1. Total funds deposited
      const depositTxs = await this.prisma.walletTransaction.aggregate({
        where: { walletId: wallet.id, type: 'DEPOSIT' },
        _sum: { amount: true },
        _count: { id: true },
      });
      const totalDeposited = Number(depositTxs._sum.amount || 0);

      // 2. Total spent on contract milestones
      const spendTxs = await this.prisma.walletTransaction.aggregate({
        where: { walletId: wallet.id, type: 'ESCROW_FUNDING' },
        _sum: { amount: true },
        _count: { id: true },
      });
      const totalSpent = Math.abs(Number(spendTxs._sum.amount || 0));

      // 3. Funds currently held in escrow for client's contracts
      const clientEscrows = await this.prisma.escrow.findMany({
        where: {
          contract: {
            clientId: userId,
            status: { in: ['FUNDED', 'IN_PROGRESS'] },
          },
        },
        select: { balance: true },
      });
      const escrowHeld = clientEscrows.reduce(
        (sum, e) => sum + Number(e.balance || 0),
        0,
      );

      // 4. Pending payments
      const pendingPayments = await this.prisma.payment.findMany({
        where: { userId, status: 'PENDING' },
        select: {
          id: true,
          amount: true,
          referenceId: true,
          createdAt: true,
          provider: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      const pendingDepositsCount = pendingPayments.length;
      const pendingDepositsAmount = pendingPayments.reduce(
        (acc, p) => acc + Number(p.amount || 0),
        0,
      );

      // 5. Saved payment methods count
      const savedMethodsCount = await this.prisma.payoutMethod.count({
        where: { userId },
      });

      // 6. Recent transactions
      const recentTransactions = await this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      return {
        role: 'CLIENT',
        currency: 'PKR',
        balance,
        lockedBalance,
        availableBalance,
        totalDeposited,
        totalSpent,
        escrowHeld,
        pendingDepositsCount,
        pendingDepositsAmount,
        pendingPayments,
        savedMethodsCount,
        recentTransactions,
      };
    } else {
      // SPECIALIST / FREELANCER
      // 1. Total lifetime earnings from milestone releases
      const earningsTxs = await this.prisma.walletTransaction.aggregate({
        where: { walletId: wallet.id, type: 'MILESTONE_RELEASE' },
        _sum: { amount: true },
        _count: { id: true },
      });
      const totalEarnings = Number(earningsTxs._sum.amount || 0);

      // 2. Earnings from current 30-day period
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const periodEarningsTxs = await this.prisma.walletTransaction.aggregate({
        where: {
          walletId: wallet.id,
          type: 'MILESTONE_RELEASE',
          createdAt: { gte: thirtyDaysAgo },
        },
        _sum: { amount: true },
      });
      const periodEarnings = Number(periodEarningsTxs._sum.amount || 0);

      // 3. Funds currently held in escrow for freelancer in funded contracts
      const specialistContracts = await this.prisma.contract.findMany({
        where: {
          specialistId: userId,
          status: { in: ['FUNDED', 'IN_PROGRESS'] },
        },
        include: { escrow: true },
      });
      const escrowHeldForMe = specialistContracts.reduce(
        (sum, c) => sum + Number(c.escrow?.balance || 0),
        0,
      );

      // 4. Total withdrawn (COMPLETED withdrawals)
      const completedWd = await this.prisma.withdrawalRequest.aggregate({
        where: { userId, status: 'COMPLETED' },
        _sum: { amount: true },
        _count: { id: true },
      });
      const totalWithdrawn = Number(completedWd._sum.amount || 0);

      // 5. Pending withdrawals (REQUESTED or PROCESSING)
      const pendingWd = await this.prisma.withdrawalRequest.aggregate({
        where: { userId, status: { in: ['REQUESTED', 'PROCESSING'] } },
        _sum: { amount: true },
        _count: { id: true },
      });
      const pendingWithdrawn = Number(pendingWd._sum.amount || 0);

      // 6. Recent transactions
      const recentTransactions = await this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      // 7. Saved payout methods
      const payoutMethods = await this.prisma.payoutMethod.findMany({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });

      return {
        role: 'SPECIALIST',
        currency: 'PKR',
        balance,
        lockedBalance,
        availableBalance, // Net available to withdraw
        totalEarnings,
        periodEarnings,
        pendingEarnings: escrowHeldForMe,
        escrowHeldForMe,
        releasedEarnings: totalEarnings,
        totalWithdrawn,
        pendingWithdrawn,
        payoutMethods,
        recentTransactions,
      };
    }
  }

  async deposit(userId: string, dto: DepositDto) {
    if (dto.amount <= 0) {
      throw new BadRequestException('Deposit amount must be greater than zero');
    }

    if (dto.amount < 100) {
      throw new BadRequestException('Minimum deposit amount is PKR 100');
    }

    const wallet = await this.getOrCreateWallet(userId);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(100000 + Math.random() * 900000);
    const referenceId = `DEP-${dateStr}-${rand}`;

    const isProd = process.env.NODE_ENV === 'production';
    const provider = dto.provider || 'BANK_TRANSFER';

    // In production, bank transfers generate pending payment references for manual / 1Link verification.
    // In dev / test / sandbox, deposits auto-confirm to facilitate end-to-end testing.
    const shouldAutoCredit = !isProd || provider === 'SANDBOX';

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          userId,
          amount: dto.amount,
          currency: 'PKR',
          provider: provider as any,
          status: shouldAutoCredit ? 'COMPLETED' : 'PENDING',
          referenceId,
          gatewayResponse: {
            depositChannel: provider,
            description: dto.description || 'Paklance Wallet Deposit',
          },
        },
      });

      let updatedWallet = wallet;
      if (shouldAutoCredit) {
        updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: dto.amount } },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            amount: dto.amount,
            type: 'DEPOSIT',
            referenceId,
            description:
              dto.description || `Confirmed Wallet Deposit (${provider})`,
          },
        });

        if (tx.notification?.create) {
          await tx.notification.create({
            data: {
              userId,
              type: 'DEPOSIT_CONFIRMED',
              message: `Your deposit of PKR ${dto.amount.toLocaleString()} has been confirmed and credited to your wallet balance.`,
            },
          }).catch(() => {});
        }
      }

      return {
        message: shouldAutoCredit
          ? 'Deposit completed successfully. Funds credited to your available balance.'
          : 'Deposit request created. Please transfer funds to the designated 1Link Paklance escrow account with your reference ID.',
        referenceId,
        paymentId: payment.id,
        amount: dto.amount,
        status: payment.status,
        provider,
        wallet: updatedWallet,
      };
    });
  }

  /**
   * Two-phase withdrawal initiation:
   * 1. Validates available balance (balance - lockedBalance >= amount).
   * 2. Moves funds into lockedBalance (reserving them without premature destruction).
   * 3. Creates WithdrawalRequest with status REQUESTED and unique reference ID.
   */
  async withdraw(userId: string, dto: WithdrawDto) {
    if (dto.amount <= 0) {
      throw new BadRequestException('Withdrawal amount must be greater than zero');
    }

    if (dto.amount < 500) {
      throw new BadRequestException('Minimum withdrawal amount is PKR 500');
    }

    const wallet = await this.getOrCreateWallet(userId);
    const balance = Number(wallet.balance);
    const lockedBalance = Number(wallet.lockedBalance || 0);
    const availableBalance = balance - lockedBalance;

    if (availableBalance < dto.amount) {
      throw new BadRequestException(
        `Insufficient available balance. Available: PKR ${availableBalance.toLocaleString()}`,
      );
    }

    // Resolve payout method snapshot
    let snapshot: any = null;
    let payoutMethodId: string | null = null;

    if (dto.payoutMethodId) {
      const pm = await this.prisma.payoutMethod.findUnique({
        where: { id: dto.payoutMethodId },
      });
      if (!pm) throw new NotFoundException('Payout method not found');
      if (pm.userId !== userId) {
        throw new ForbiddenException('You do not own this payout method');
      }
      payoutMethodId = pm.id;
      snapshot = {
        type: pm.type,
        accountTitle: pm.accountTitle,
        accountNumber: pm.accountNumber,
        bankName: pm.bankName,
      };
    } else if (dto.accountTitle && dto.accountNumber) {
      if (dto.type && dto.channel && dto.type !== dto.channel) {
        throw new BadRequestException('Payout channel and type mismatch');
      }
      const resolvedType = dto.type || dto.channel;
      if (!resolvedType) {
        throw new BadRequestException('Payout channel or type must be specified');
      }
      snapshot = {
        type: resolvedType,
        accountTitle: dto.accountTitle.trim(),
        accountNumber: dto.accountNumber.trim(),
        bankName: resolvedType === PayoutType.BANK ? 'Bank Transfer (1Link)' : resolvedType,
      };
    } else {
      // Check if user has a default payout method
      const defaultPm = await this.prisma.payoutMethod.findFirst({
        where: { userId, isDefault: true },
      });
      if (defaultPm) {
        payoutMethodId = defaultPm.id;
        snapshot = {
          type: defaultPm.type,
          accountTitle: defaultPm.accountTitle,
          accountNumber: defaultPm.accountNumber,
          bankName: defaultPm.bankName,
        };
      } else {
        throw new BadRequestException(
          'Please select or provide a valid payout method for withdrawal',
        );
      }
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(100000 + Math.random() * 900000);
    const referenceId = `WD-${dateStr}-${rand}`;

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock the withdrawal amount
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { lockedBalance: { increment: dto.amount } },
      });

      // 2. Create the withdrawal request
      const request = await tx.withdrawalRequest.create({
        data: {
          userId,
          walletId: wallet.id,
          payoutMethodId,
          amount: dto.amount,
          fee: 0,
          netAmount: dto.amount,
          status: WithdrawalStatus.REQUESTED,
          referenceId,
          payoutMethodSnapshot: snapshot,
        },
      });

      // 3. Log transaction
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: -dto.amount,
          type: 'WITHDRAWAL_REQUESTED',
          referenceId,
          description: `Withdrawal request to ${snapshot.type} (${snapshot.accountNumber.slice(-4)})`,
        },
      });

      // 4. Send notification
      if (tx.notification?.create) {
        await tx.notification.create({
          data: {
            userId,
            type: 'WITHDRAWAL_SUBMITTED',
            message: `Withdrawal request for PKR ${dto.amount.toLocaleString()} submitted (${referenceId}). Funds reserved pending 1Link interbank clearing.`,
          },
        }).catch(() => {});
      }

      return {
        message:
          'Withdrawal request submitted. Funds are reserved pending admin settlement.',
        withdrawalRequest: request,
      };
    });
  }

  async getUserWithdrawals(userId: string) {
    return this.prisma.withdrawalRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { payoutMethod: true },
    });
  }

  async cancelWithdrawal(userId: string, id: string) {
    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id },
      include: { wallet: true },
    });

    if (!request) throw new NotFoundException('Withdrawal request not found');
    if (request.userId !== userId) {
      throw new ForbiddenException('You do not own this withdrawal request');
    }

    if (request.status !== WithdrawalStatus.REQUESTED) {
      throw new BadRequestException(
        'Only pending withdrawal requests can be cancelled',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Update status to CANCELLED
      const updated = await tx.withdrawalRequest.update({
        where: { id },
        data: { status: WithdrawalStatus.CANCELLED },
      });

      // 2. Unlock the funds
      await tx.wallet.update({
        where: { id: request.walletId },
        data: { lockedBalance: { decrement: request.amount } },
      });

      // 3. Log transaction
      await tx.walletTransaction.create({
        data: {
          walletId: request.walletId,
          amount: request.amount,
          type: 'WITHDRAWAL_CANCELLED',
          referenceId: request.referenceId,
          description: `Cancelled withdrawal request ${request.referenceId}. Funds restored.`,
        },
      });

      if (tx.notification?.create) {
        await tx.notification.create({
          data: {
            userId,
            type: 'WITHDRAWAL_CANCELLED',
            message: `Withdrawal request ${request.referenceId} has been cancelled. PKR ${Number(request.amount).toLocaleString()} restored to your available balance.`,
          },
        }).catch(() => {});
      }

      return {
        message: 'Withdrawal request cancelled. Funds restored to available balance.',
        withdrawalRequest: updated,
      };
    });
  }

  async getTransactionHistory(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    return this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async exportStatement(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    const txs = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
    });

    const rows = [
      ['Date', 'Reference', 'Type', 'Amount (PKR)', 'Fee (PKR)', 'Description'].join(','),
      ...txs.map((t) =>
        [
          t.createdAt.toISOString().slice(0, 10),
          `"${t.referenceId || ''}"`,
          `"${t.type}"`,
          Number(t.amount).toFixed(2),
          Number(t.fee || 0).toFixed(2),
          `"${(t.description || '').replace(/"/g, '""')}"`,
        ].join(','),
      ),
    ];

    return {
      csv: rows.join('\n'),
      totalTransactions: txs.length,
      currentBalance: Number(wallet.balance),
    };
  }
}
