import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePayoutMethodDto } from './dto/payout-method.dto';

@Injectable()
export class PayoutMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  async addPayoutMethod(userId: string, dto: CreatePayoutMethodDto) {
    const existingCount = await this.prisma.payoutMethod.count({
      where: { userId },
    });

    const isDefault = dto.isDefault ?? existingCount === 0;

    return this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.payoutMethod.updateMany({
          where: { userId },
          data: { isDefault: false },
        });
      }

      const existing = await tx.payoutMethod.findFirst({
        where: {
          userId,
          accountNumber: dto.accountNumber.trim(),
        },
      });

      if (existing) {
        return tx.payoutMethod.update({
          where: { id: existing.id },
          data: {
            type: dto.type,
            accountTitle: dto.accountTitle.trim(),
            bankName: dto.bankName?.trim() || null,
            isDefault,
          },
        });
      }

      return tx.payoutMethod.create({
        data: {
          userId,
          type: dto.type,
          accountTitle: dto.accountTitle.trim(),
          accountNumber: dto.accountNumber.trim(),
          bankName: dto.bankName?.trim() || null,
          isDefault,
        },
      });
    });
  }

  async getPayoutMethods(userId: string) {
    return this.prisma.payoutMethod.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async setDefault(userId: string, id: string) {
    const method = await this.prisma.payoutMethod.findUnique({ where: { id } });
    if (!method) throw new NotFoundException('Payout method not found');
    if (method.userId !== userId) {
      throw new ForbiddenException('You do not own this payout method');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.payoutMethod.updateMany({
        where: { userId },
        data: { isDefault: false },
      });

      return tx.payoutMethod.update({
        where: { id },
        data: { isDefault: true },
      });
    });
  }

  async remove(userId: string, id: string) {
    const method = await this.prisma.payoutMethod.findUnique({ where: { id } });
    if (!method) throw new NotFoundException('Payout method not found');
    if (method.userId !== userId) {
      throw new ForbiddenException('You do not own this payout method');
    }

    return this.prisma.payoutMethod.delete({ where: { id } });
  }
}
