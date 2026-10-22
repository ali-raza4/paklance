import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JazzCashProvider } from './providers/jazzcash.provider';
import { EasypaisaProvider } from './providers/easypaisa.provider';
import { InitiatePaymentDto, SandboxSimulateDto } from './dto/payment.dto';
import {
  PaymentProvider,
  PaymentStatus,
  ContractStatus,
} from '@prisma/client';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jazzCashProvider: JazzCashProvider,
    private readonly easypaisaProvider: EasypaisaProvider,
  ) {}

  /**
   * Generates a unique, non-guessable payment reference
   */
  private generateReferenceId(): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(100000 + Math.random() * 900000);
    return `PAY-${dateStr}-${rand}`;
  }

  /**
   * Initiates payment checkout for contract milestone or wallet deposit
   */
  async initiatePayment(userId: string, dto: InitiatePaymentDto) {
    if (dto.amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    // If funding a contract, verify contract exists and belongs to client
    let contract: any = null;
    if (dto.contractId) {
      contract = await this.prisma.contract.findUnique({
        where: { id: dto.contractId },
        include: { escrow: true, milestones: true },
      });
      if (!contract) throw new NotFoundException('Contract not found');
      if (contract.clientId !== userId) {
        throw new ForbiddenException(
          'Only the client can fund this contract milestone',
        );
      }

      // Map legacy 'milestone' alias to 'milestoneId' if provided
      if (!dto.milestoneId && dto.milestone) {
        dto.milestoneId = dto.milestone;
      }

      if (dto.milestoneId) {
        const milestoneExists = contract.milestones?.some(
          (m: any) => m.id === dto.milestoneId,
        );
        if (!milestoneExists) {
          throw new BadRequestException(
            'Milestone does not belong to this contract',
          );
        }
      }
    }

    const isProd = process.env.NODE_ENV === 'production';
    const referenceId = this.generateReferenceId();

    // Production safety check: Sandbox provider is strictly forbidden on live production
    if (dto.provider === PaymentProvider.SANDBOX && isProd) {
      throw new ForbiddenException(
        'Sandbox payment simulation is disabled on the live production environment',
      );
    }

    // Create database Payment record with PENDING status
    const payment = await this.prisma.payment.create({
      data: {
        userId,
        contractId: dto.contractId || null,
        amount: dto.amount,
        currency: 'PKR',
        provider: dto.provider,
        status: PaymentStatus.PENDING,
        referenceId,
      },
    });

    const description =
      dto.description ||
      (contract ? `Funding for Contract #${contract.id.slice(0, 8)}` : 'Wallet Deposit');
    const returnUrl =
      dto.returnUrl || `${process.env.APP_URL || 'http://localhost:8080'}/#wallet`;

    if (dto.provider === PaymentProvider.JAZZCASH) {
      const checkout = this.jazzCashProvider.createCheckoutPayload({
        referenceId,
        amount: dto.amount,
        description,
        returnUrl,
      });

      return {
        paymentId: payment.id,
        referenceId,
        provider: dto.provider,
        amount: dto.amount,
        status: payment.status,
        isConfigured: checkout.isConfigured,
        gatewayUrl: checkout.url,
        checkoutPayload: checkout.payload,
        message: checkout.isConfigured
          ? 'Redirect client to JazzCash payment gateway'
          : 'Live payment integration pending merchant onboarding.',
      };
    }

    if (dto.provider === PaymentProvider.EASYPAISA) {
      const checkout = this.easypaisaProvider.createCheckoutPayload({
        referenceId,
        amount: dto.amount,
        description,
        returnUrl,
      });

      return {
        paymentId: payment.id,
        referenceId,
        provider: dto.provider,
        amount: dto.amount,
        status: payment.status,
        isConfigured: checkout.isConfigured,
        gatewayUrl: checkout.url,
        checkoutPayload: checkout.payload,
        message: checkout.isConfigured
          ? 'Redirect client to Easypaisa payment gateway'
          : 'Live payment integration pending merchant onboarding.',
      };
    }

    // Sandbox / Bank Transfer
    return {
      paymentId: payment.id,
      referenceId,
      provider: dto.provider,
      amount: dto.amount,
      status: payment.status,
      isConfigured: true,
      message:
        dto.provider === PaymentProvider.BANK_TRANSFER
          ? 'Manual enterprise bank transfer reference generated.'
          : 'Sandbox payment session created.',
    };
  }

  /**
   * Public webhook callback listener for JazzCash IPN
   */
  async handleJazzCashCallback(payload: Record<string, any>, headers: Record<string, any>) {
    const verified = this.jazzCashProvider.verifyCallback(payload);

    // 1. Audit log the raw webhook event
    const webhookLog = await this.prisma.paymentWebhookLog.create({
      data: {
        provider: PaymentProvider.JAZZCASH,
        eventType: 'IPN_CALLBACK',
        referenceId: verified.txnRefNo || null,
        payload,
        headers,
        signatureValid: verified.valid,
      },
    });

    if (!verified.txnRefNo) {
      await this.prisma.paymentWebhookLog.update({
        where: { id: webhookLog.id },
        data: { error: 'Missing transaction reference number' },
      });
      throw new BadRequestException('Missing transaction reference number');
    }

    const payment = await this.prisma.payment.findUnique({
      where: { referenceId: verified.txnRefNo },
      include: { contract: { include: { escrow: true } } },
    });

    if (!payment) {
      await this.prisma.paymentWebhookLog.update({
        where: { id: webhookLog.id },
        data: { error: `Payment not found for reference ${verified.txnRefNo}` },
      });
      throw new NotFoundException('Payment reference not found');
    }

    // Idempotency check: if already completed, acknowledge safely without double-crediting
    if (payment.status === PaymentStatus.COMPLETED) {
      return { status: 'OK', message: 'Payment already processed' };
    }

    // Verify signature
    if (!verified.valid) {
      await this.prisma.paymentWebhookLog.update({
        where: { id: webhookLog.id },
        data: { error: 'Invalid HMAC-SHA256 signature' },
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, gatewayResponse: payload },
      });
      throw new BadRequestException('Invalid signature');
    }

    // Verify Amount
    if (verified.amount > 0 && Math.abs(Number(payment.amount) - verified.amount) > 1) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.MISMATCHED, gatewayResponse: payload },
      });
      throw new BadRequestException('Payment amount mismatch');
    }

    // Check Gateway response code: '000' or '121' represents success
    const isSuccess = verified.responseCode === '000' || verified.responseCode === '121';

    return this.prisma.$transaction(async (tx) => {
      if (isSuccess) {
        // Mark payment COMPLETED
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.COMPLETED,
            gatewayTxnId: verified.gatewayTxnId,
            gatewayResponse: payload,
          },
        });

        // Fund contract Escrow if linked to a contract, otherwise credit client wallet (Deposit)
        if (payment.contractId && payment.contract) {
          const escrow = payment.contract.escrow;
          if (escrow) {
            await tx.escrow.update({
              where: { id: escrow.id },
              data: { balance: { increment: payment.amount } },
            });

            await tx.ledgerEntry.create({
              data: {
                escrowId: escrow.id,
                sourceWalletId: payment.userId,
                destinationWalletId: escrow.id,
                amount: payment.amount,
                status: 'COMPLETED',
              },
            });
          }

          await tx.contract.update({
            where: { id: payment.contractId },
            data: { status: ContractStatus.FUNDED },
          });
        } else {
          // Direct Wallet Deposit
          let wallet = await tx.wallet.findFirst({
            where: { userId: payment.userId },
          });
          if (!wallet) {
            wallet = await tx.wallet.create({
              data: { userId: payment.userId, balance: 0, lockedBalance: 0 },
            });
          }

          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: payment.amount } },
          });

          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              amount: payment.amount,
              type: 'DEPOSIT',
              referenceId: payment.referenceId,
              description: 'Confirmed JazzCash Wallet Deposit',
            },
          });

          await tx.notification.create({
            data: {
              userId: payment.userId,
              type: 'DEPOSIT_CONFIRMED',
              message: `JazzCash deposit of PKR ${Number(payment.amount).toLocaleString()} confirmed and added to your available wallet balance.`,
            },
          }).catch(() => {});
        }

        await tx.paymentWebhookLog.update({
          where: { id: webhookLog.id },
          data: { processed: true },
        });

        return {
          status: 'SUCCESS',
          message: payment.contractId
            ? 'Payment verified and escrow funded'
            : 'Payment verified and wallet credited',
        };
      } else {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            gatewayResponse: payload,
          },
        });
        return { status: 'FAILED', message: verified.responseMessage || 'Gateway payment failed' };
      }
    });
  }

  /**
   * Public webhook callback listener for Easypaisa IPN
   */
  async handleEasypaisaCallback(payload: Record<string, any>, headers: Record<string, any>) {
    const verified = this.easypaisaProvider.verifyCallback(payload);

    const webhookLog = await this.prisma.paymentWebhookLog.create({
      data: {
        provider: PaymentProvider.EASYPAISA,
        eventType: 'IPN_CALLBACK',
        referenceId: verified.orderRefNum || null,
        payload,
        headers,
        signatureValid: verified.valid,
      },
    });

    if (!verified.orderRefNum) {
      throw new BadRequestException('Missing order reference number');
    }

    const payment = await this.prisma.payment.findUnique({
      where: { referenceId: verified.orderRefNum },
      include: { contract: { include: { escrow: true } } },
    });

    if (!payment) throw new NotFoundException('Payment reference not found');

    if (payment.status === PaymentStatus.COMPLETED) {
      return { status: 'OK', message: 'Payment already processed' };
    }

    if (!verified.valid) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, gatewayResponse: payload },
      });
      throw new BadRequestException('Invalid signature');
    }

    const isSuccess = verified.status === '0000' || verified.status === '000';

    return this.prisma.$transaction(async (tx) => {
      if (isSuccess) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.COMPLETED,
            gatewayTxnId: verified.transactionId,
            gatewayResponse: payload,
          },
        });

        if (payment.contractId && payment.contract) {
          const escrow = payment.contract.escrow;
          if (escrow) {
            await tx.escrow.update({
              where: { id: escrow.id },
              data: { balance: { increment: payment.amount } },
            });

            await tx.ledgerEntry.create({
              data: {
                escrowId: escrow.id,
                sourceWalletId: payment.userId,
                destinationWalletId: escrow.id,
                amount: payment.amount,
                status: 'COMPLETED',
              },
            });
          }

          await tx.contract.update({
            where: { id: payment.contractId },
            data: { status: ContractStatus.FUNDED },
          });
        } else {
          // Direct Wallet Deposit
          let wallet = await tx.wallet.findFirst({
            where: { userId: payment.userId },
          });
          if (!wallet) {
            wallet = await tx.wallet.create({
              data: { userId: payment.userId, balance: 0, lockedBalance: 0 },
            });
          }

          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: payment.amount } },
          });

          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              amount: payment.amount,
              type: 'DEPOSIT',
              referenceId: payment.referenceId,
              description: 'Confirmed Easypaisa Wallet Deposit',
            },
          });

          await tx.notification.create({
            data: {
              userId: payment.userId,
              type: 'DEPOSIT_CONFIRMED',
              message: `Easypaisa deposit of PKR ${Number(payment.amount).toLocaleString()} confirmed and added to your available wallet balance.`,
            },
          }).catch(() => {});
        }

        await tx.paymentWebhookLog.update({
          where: { id: webhookLog.id },
          data: { processed: true },
        });

        return {
          status: 'SUCCESS',
          message: payment.contractId
            ? 'Easypaisa payment verified and escrow funded'
            : 'Easypaisa payment verified and wallet credited',
        };
      } else {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED, gatewayResponse: payload },
        });
        return { status: 'FAILED', message: verified.desc || 'Easypaisa transaction failed' };
      }
    });
  }

  /**
   * Sandbox simulation for local/testing environments ONLY.
   * Hard-guarded against execution in production.
   */
  async simulateSandboxPayment(userId: string, dto: SandboxSimulateDto) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException(
        'Sandbox payment simulation is strictly disabled on production',
      );
    }

    const payment = await this.prisma.payment.findUnique({
      where: { referenceId: dto.referenceId },
      include: { contract: { include: { escrow: true } } },
    });

    if (!payment) throw new NotFoundException('Payment reference not found');
    if (payment.userId !== userId) {
      throw new ForbiddenException('You do not own this payment session');
    }

    if (payment.status === PaymentStatus.COMPLETED) {
      return { status: 'OK', message: 'Payment already completed', payment };
    }

    const targetStatus = dto.status || PaymentStatus.COMPLETED;

    return this.prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: targetStatus,
          gatewayTxnId: `SANDBOX-${Date.now()}`,
          gatewayResponse: { simulated: true, completedAt: new Date().toISOString() },
        },
      });

      if (targetStatus === PaymentStatus.COMPLETED) {
        if (payment.contractId && payment.contract) {
          const escrow = payment.contract.escrow;
          if (escrow) {
            await tx.escrow.update({
              where: { id: escrow.id },
              data: { balance: { increment: payment.amount } },
            });

            await tx.ledgerEntry.create({
              data: {
                escrowId: escrow.id,
                sourceWalletId: payment.userId,
                destinationWalletId: escrow.id,
                amount: payment.amount,
                status: 'COMPLETED',
              },
            });
          }

          await tx.contract.update({
            where: { id: payment.contractId },
            data: { status: ContractStatus.FUNDED },
          });
        } else {
          // Direct Wallet Deposit simulation
          let wallet = await tx.wallet.findFirst({
            where: { userId: payment.userId },
          });
          if (!wallet) {
            wallet = await tx.wallet.create({
              data: { userId: payment.userId, balance: 0, lockedBalance: 0 },
            });
          }

          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: payment.amount } },
          });

          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              amount: payment.amount,
              type: 'DEPOSIT',
              referenceId: payment.referenceId,
              description: 'Sandbox Wallet Deposit Simulated',
            },
          });
        }
      }

      return {
        status: targetStatus,
        message:
          targetStatus === PaymentStatus.COMPLETED
            ? 'Sandbox payment simulated: Escrow funded'
            : 'Sandbox payment failed',
        payment: updatedPayment,
      };
    });
  }

  /**
   * Queries payment status by reference ID
   */
  async getPaymentStatus(userId: string, referenceId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { referenceId },
      include: {
        contract: {
          select: {
            id: true,
            status: true,
            job: { select: { title: true } },
            escrow: { select: { balance: true } },
          },
        },
      },
    });

    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.userId !== userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.role !== 'ADMIN') {
        throw new ForbiddenException('Not authorized to view this payment');
      }
    }

    return payment;
  }
}
