import { Test, TestingModule } from '@nestjs/testing';
import { WalletService } from './wallet.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WalletService Summary & Statement', () => {
  let service: WalletService;
  let prisma: any;

  const mockClientWallet = {
    id: 'w-client-1',
    userId: 'client-1',
    balance: 50000,
    lockedBalance: 5000,
  };

  const mockSpecialistWallet = {
    id: 'w-spec-1',
    userId: 'spec-1',
    balance: 35000,
    lockedBalance: 5000,
  };

  beforeEach(async () => {
    prisma = {
      wallet: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      walletTransaction: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        aggregate: jest.fn(),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      escrow: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      withdrawalRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        aggregate: jest.fn(),
      },
      payoutMethod: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(1),
      },
    };

    service = new WalletService(prisma as PrismaService);
  });

  it('should return client wallet summary with available balance and escrow metrics', async () => {
    prisma.wallet.findFirst.mockResolvedValue(mockClientWallet);
    prisma.walletTransaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 50000 }, _count: { id: 2 } }) // DEPOSIT
      .mockResolvedValueOnce({ _sum: { amount: 15000 }, _count: { id: 1 } }); // ESCROW_FUNDING
    prisma.escrow.findMany.mockResolvedValue([
      { balance: 15000 },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-pending', amount: 10000, referenceId: 'DEP-1', createdAt: new Date(), provider: 'BANK_TRANSFER' },
    ]);
    prisma.payoutMethod.count.mockResolvedValue(2);
    prisma.walletTransaction.findMany.mockResolvedValue([]);

    const summary = await service.getSummary('client-1', 'CLIENT');

    expect(summary.role).toBe('CLIENT');
    expect(summary.balance).toBe(50000);
    expect(summary.availableBalance).toBe(45000); // 50000 - 5000 locked
    expect(summary.totalDeposited).toBe(50000);
    expect(summary.totalSpent).toBe(15000);
    expect(summary.escrowHeld).toBe(15000);
    expect(summary.pendingDepositsCount).toBe(1);
    expect(summary.pendingDepositsAmount).toBe(10000);
  });

  it('should return specialist wallet summary with earnings and withdrawable metrics', async () => {
    prisma.wallet.findFirst.mockResolvedValue(mockSpecialistWallet);
    prisma.walletTransaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 36000 }, _count: { id: 3 } }) // lifetime earnings
      .mockResolvedValueOnce({ _sum: { amount: 18000 }, _count: { id: 2 } }); // period earnings
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-2', escrow: { balance: 20000 } },
    ]);
    prisma.withdrawalRequest.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 1000 }, _count: { id: 1 } }) // completed
      .mockResolvedValueOnce({ _sum: { amount: 5000 }, _count: { id: 1 } }); // pending
    prisma.payoutMethod.findMany.mockResolvedValue([]);
    prisma.walletTransaction.findMany.mockResolvedValue([]);

    const summary = await service.getSummary('spec-1', 'SPECIALIST');

    expect(summary.role).toBe('SPECIALIST');
    expect(summary.balance).toBe(35000);
    expect(summary.availableBalance).toBe(30000); // 35000 - 5000 locked
    expect(summary.totalEarnings).toBe(36000);
    expect(summary.periodEarnings).toBe(18000);
    expect(summary.escrowHeldForMe).toBe(20000);
    expect(summary.totalWithdrawn).toBe(1000);
    expect(summary.pendingWithdrawn).toBe(5000);
  });

  it('should generate CSV statement for user transactions', async () => {
    prisma.wallet.findFirst.mockResolvedValue(mockClientWallet);
    prisma.walletTransaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        createdAt: new Date('2026-01-01T10:00:00Z'),
        type: 'DEPOSIT',
        description: 'Bank transfer deposit',
        amount: 25000,
        fee: 0,
        status: 'COMPLETED',
        referenceId: 'DEP-123',
      },
    ]);

    const result = await service.exportStatement('client-1');
    expect(result.csv).toContain('Date,Reference,Type,Amount (PKR),Fee (PKR),Description');
    expect(result.csv).toContain('DEP-123');
    expect(result.csv).toContain('25000.00');
    expect(result.totalTransactions).toBe(1);
    expect(result.currentBalance).toBe(50000);
  });
});
