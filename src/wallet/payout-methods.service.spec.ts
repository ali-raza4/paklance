import { Test, TestingModule } from '@nestjs/testing';
import { PayoutMethodsService } from './payout-methods.service';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutType } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('PayoutMethodsService', () => {
  let service: PayoutMethodsService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      payoutMethod: {
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutMethodsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PayoutMethodsService>(PayoutMethodsService);
  });

  describe('addPayoutMethod', () => {
    it('saves a new bank account and marks it default if first method', async () => {
      mockPrisma.payoutMethod.count.mockResolvedValue(0);
      mockPrisma.payoutMethod.findFirst.mockResolvedValue(null);
      mockPrisma.payoutMethod.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'pm-1', ...data }),
      );

      const result = await service.addPayoutMethod('user-1', {
        type: PayoutType.BANK,
        accountTitle: 'Fatima Zahra',
        accountNumber: 'PK36SCBL0000001123456701',
        bankName: 'Standard Chartered',
      });

      expect(result.id).toBe('pm-1');
      expect(result.isDefault).toBe(true);
      expect(mockPrisma.payoutMethod.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: PayoutType.BANK,
          accountTitle: 'Fatima Zahra',
          accountNumber: 'PK36SCBL0000001123456701',
          bankName: 'Standard Chartered',
          isDefault: true,
        },
      });
    });

    it('prevents duplicate records when re-saving or editing an existing account number', async () => {
      mockPrisma.payoutMethod.count.mockResolvedValue(1);
      mockPrisma.payoutMethod.findFirst.mockResolvedValue({
        id: 'pm-existing-1',
        userId: 'user-1',
        type: PayoutType.BANK,
        accountTitle: 'Old Title',
        accountNumber: 'PK36SCBL0000001123456701',
        bankName: 'Old Bank',
        isDefault: true,
      });
      mockPrisma.payoutMethod.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'pm-existing-1', ...data }),
      );

      const result = await service.addPayoutMethod('user-1', {
        type: PayoutType.BANK,
        accountTitle: 'Updated Beneficiary Title',
        accountNumber: 'PK36SCBL0000001123456701',
        bankName: 'Meezan Bank',
        isDefault: true,
      });

      expect(result.id).toBe('pm-existing-1');
      expect(result.accountTitle).toBe('Updated Beneficiary Title');
      expect(mockPrisma.payoutMethod.update).toHaveBeenCalledWith({
        where: { id: 'pm-existing-1' },
        data: {
          type: PayoutType.BANK,
          accountTitle: 'Updated Beneficiary Title',
          bankName: 'Meezan Bank',
          isDefault: true,
        },
      });
      expect(mockPrisma.payoutMethod.create).not.toHaveBeenCalled();
    });
  });

  describe('getPayoutMethods', () => {
    it('strictly isolates methods to the authenticated user ID', async () => {
      mockPrisma.payoutMethod.findMany.mockResolvedValue([
        {
          id: 'pm-1',
          userId: 'user-1',
          type: PayoutType.BANK,
          accountTitle: 'My Bank',
          accountNumber: 'PK36SCBL0000001123456701',
          isDefault: true,
        },
      ]);

      const list = await service.getPayoutMethods('user-1');
      expect(list).toHaveLength(1);
      expect(mockPrisma.payoutMethod.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
    });
  });

  describe('security checks on setDefault and remove', () => {
    it('throws ForbiddenException if user tries to remove someone else payout method', async () => {
      mockPrisma.payoutMethod.findUnique.mockResolvedValue({
        id: 'pm-stranger',
        userId: 'other-user',
      });

      await expect(
        service.remove('user-1', 'pm-stranger'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if payout method does not exist', async () => {
      mockPrisma.payoutMethod.findUnique.mockResolvedValue(null);

      await expect(
        service.remove('user-1', 'pm-nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
