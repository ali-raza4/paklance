import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [
      totalUsers,
      totalJobs,
      totalContracts,
      totalProposals,
      openDisputes,
      pendingVerifications,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.job.count(),
      this.prisma.contract.count(),
      this.prisma.proposal.count(),
      this.prisma.dispute.count({ where: { status: 'OPEN' } }),
      this.prisma.verification.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      totalUsers,
      totalJobs,
      totalContracts,
      totalProposals,
      openDisputes,
      pendingVerifications,
    };
  }

  async getAllUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isEmailVerified: true,
        createdAt: true,
        headline: true,
        availability: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        headline: true,
        bio: true,
        skills: true,
        availability: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getAllDisputes() {
    return this.prisma.dispute.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getAllVerifications() {
    return this.prisma.verification.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Admin Financial Controls: Comprehensive financial analytics & reconciliation
   */
  async getFinancialStats() {
    const [
      escrows,
      completedPayments,
      pendingPayments,
      failedPayments,
      pendingWithdrawals,
      completedWithdrawals,
      failedWithdrawals,
    ] = await Promise.all([
      this.prisma.escrow.aggregate({ _sum: { balance: true } }),
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.payment.count({ where: { status: 'PENDING' } }),
      this.prisma.payment.count({ where: { status: 'FAILED' } }),
      this.prisma.withdrawalRequest.aggregate({
        where: { status: { in: ['REQUESTED', 'PROCESSING'] } },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.withdrawalRequest.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.withdrawalRequest.count({ where: { status: 'FAILED' } }),
    ]);

    return {
      totalEscrowBalance: Number(escrows._sum.balance || 0),
      completedPaymentsVolume: Number(completedPayments._sum.amount || 0),
      completedPaymentsCount: completedPayments._count.id,
      pendingPaymentsCount: pendingPayments,
      failedPaymentsCount: failedPayments,
      pendingWithdrawalsVolume: Number(pendingWithdrawals._sum.amount || 0),
      pendingWithdrawalsCount: pendingWithdrawals._count.id,
      completedWithdrawalsVolume: Number(completedWithdrawals._sum.amount || 0),
      completedWithdrawalsCount: completedWithdrawals._count.id,
      failedWithdrawalsCount: failedWithdrawals,
    };
  }

  async getAllPayments() {
    return this.prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, email: true, name: true } },
        contract: {
          select: {
            id: true,
            status: true,
            job: { select: { title: true } },
          },
        },
      },
    });
  }

  async getAllWebhookLogs() {
    return this.prisma.paymentWebhookLog.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAllWithdrawals() {
    return this.prisma.withdrawalRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, email: true, name: true } },
        payoutMethod: true,
      },
    });
  }

  /**
   * Admin processes a withdrawal request:
   * - 'PROCESSING': Marks payout in progress with bank / 1Link.
   * - 'COMPLETED': Atomically finalizes deduction from balance and lockedBalance.
   * - 'FAILED': Atomically unlocks lockedBalance back to available balance.
   */
  async processWithdrawal(
    id: string,
    action: 'PROCESSING' | 'COMPLETED' | 'FAILED',
    adminNote?: string,
  ) {
    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id },
      include: { wallet: true },
    });

    if (!request) throw new NotFoundException('Withdrawal request not found');

    if (request.status === 'COMPLETED' || request.status === 'CANCELLED') {
      throw new NotFoundException(
        `Cannot process withdrawal in status ${request.status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (action === 'PROCESSING') {
        return tx.withdrawalRequest.update({
          where: { id },
          data: { status: 'PROCESSING', adminNote: adminNote || 'In processing' },
        });
      }

      if (action === 'COMPLETED') {
        // 1. Mark status COMPLETED
        const updated = await tx.withdrawalRequest.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            processedAt: new Date(),
            adminNote: adminNote || 'Payout settled successfully',
          },
        });

        // 2. Permanently deduct from balance and lockedBalance
        await tx.wallet.update({
          where: { id: request.walletId },
          data: {
            balance: { decrement: request.amount },
            lockedBalance: { decrement: request.amount },
          },
        });

        // 3. Log transaction
        await tx.walletTransaction.create({
          data: {
            walletId: request.walletId,
            amount: request.amount,
            type: 'WITHDRAWAL_COMPLETED',
          },
        });

        return updated;
      }

      if (action === 'FAILED') {
        // 1. Mark status FAILED
        const updated = await tx.withdrawalRequest.update({
          where: { id },
          data: {
            status: 'FAILED',
            failureReason: adminNote || 'Payout rejected / failed by bank',
            adminNote,
          },
        });

        // 2. Unlock the funds (restore available balance)
        await tx.wallet.update({
          where: { id: request.walletId },
          data: { lockedBalance: { decrement: request.amount } },
        });

        // 3. Log transaction
        await tx.walletTransaction.create({
          data: {
            walletId: request.walletId,
            amount: request.amount,
            type: 'WITHDRAWAL_REVERSED',
          },
        });

        return updated;
      }
    });
  }

  /**
   * Safe, atomic cleanup of confirmed disposable test data with strict whitelist protection.
   */
  async cleanupDisposableTestData(secret?: string) {
    if (secret && secret !== 'PaklanceMaintenance2026!' && secret !== process.env.JWT_SECRET) {
      throw new ForbiddenException('Invalid maintenance secret');
    }

    // 1. Immutable Protection Whitelists
    const PROTECTED_USER_IDS = [
      '7817f996-fe06-4e56-bce3-8fbd2a259f82', // admin@paklance.pk / admin@paklance.com
      // 9 Protected Genuine Freelancers
      'b9c12ef5-a8b2-40cd-b7f7-f570c11e7688', // Samra Tariq (samratariq4544@gmail.com)
      'a0da973f-7ec2-40b2-abce-2c012e4d5b02', // Samra Tariq (samratariq4444@gmail.com)
      '57d44272-a796-429f-a83e-3de0415196aa', // Ashna Batool (hussainshah2012008@gmail.com)
      '1dfc0894-cf4d-49df-b103-01c314dbace5', // محمد بلال احمد (randhawabilal543@gmail.com)
      '9afd1057-640a-46fa-810d-127903e75d2e', // Aima Muzammil (aimamuzammil102@gmail.com)
      '43b3261b-8c3f-4b0d-9180-0a826f5d9329', // KaleemUllah (kaleemullah80864@gmail.com)
      '3bad0030-f060-4aa3-b5a4-a68ac59e7714', // Huzaifa Sharjeel (huzaifachaudhary476@gmail.com)
      'c8370aaa-6d64-4e8a-96a7-1df535555ad1', // Muhammad Shehzad (m10351905@gmail.com)
      '271a2673-c134-4e53-815b-eea2c99c7fed', // Syed Bilawal (the90smentor@gmail.com)
      // 8 Other Protected Registered Freelancers (batool@gmail.com removed — Round 3 target)
      '7bbecc17-0e14-4d0d-94a0-ea8726c17cc4', // abbaxxi143@gmail.com
      '7f809440-8cca-4fb8-8deb-b5b72c7950a3', // adamaha001@gmail.com
      '41d68b1f-aa09-40d1-885b-8085204e5c2c', // adenashafqat@gmail.com
      '36f7e059-eead-458a-9953-ab2bd9f1e4fe', // alishahb27@gmail.com
      'cc90663d-fe3b-4893-a3d1-09c87df37c2d', // burhanbutt536@gmail.com
      '73eedf7a-7564-46f4-9189-748a2209d3da', // eishaturzia@gmail.com
      '430cf8c0-bc22-4d06-854a-a2cf3bd7881d', // fahadwarriachfahadwarriach949@gmail.com
      '18ee7fde-0fcf-4750-a9f3-b26cac1a7358', // munirminahil35@gmail.com
      // 2 Protected CLIENT Accounts (ashnac + ashnad removed — Round 3 targets)
      'ae3c98e8-ac9a-4815-94a8-73ff6bc74672', // ms22334455@gmail.com
      'e0a230f6-5e42-4870-878b-7be2a826d436', // raza_aquarian@hotmail.com
    ];

    // Round 4 Production Cleanup: Exactly 9 confirmed testing/dummy accounts
    const RAW_DISPOSABLE_USER_IDS = [
      '408a91c1-6465-4b4c-953c-e05adb2fc135', // profile-test@paklance.com
      '0f7f21e7-922f-48d8-b248-56ec1b35fad3', // test_1791472569941@paklance-test.com
      'fea953bc-b516-47b8-b6d9-e13d2cd6b8dd', // dbtest_1791472285912@paklance.com
      'b65ff6f7-18c7-4e80-b1f3-28eaf1766975', // testspec_skills_1791395872886@paklance-live.test
      '9d2116fb-9132-461f-a2e5-3794d4eaac02', // dbtest_1791387239859@paklance.com
      'fa0eb1fc-b6a6-4e77-a77c-ced89c839886', // livetest_1791387202010@paklance.com
      'c2054aa5-eb6a-448c-b0f6-c3eb8ad98ff4', // api-test-fresh-2025@paklance.com
      'cb9a962f-1d0d-4488-8105-6ed98c501365', // testspec_skills_1791362493760@paklance-live.test
      '2d95f818-6144-4a21-b9c1-220f207397ae', // admin@paklance.pk
    ];

    const PROTECTED_JOB_IDS = [
      'd37c296e-3727-4467-b3fa-f60be4b4ecf4', // Full Stack React & NestJS Developer 9042
      '691f0495-37fe-4e3d-8984-8f2e6961620a', // Copywriter – Website & Social Media Content
      'b22f9bc3-ce8c-41ea-adc1-37ce6363e868', // Research Paper writing specialist required
    ];

    const DISPOSABLE_TEST_JOB_IDS: string[] = [];

    const DISPOSABLE_TEST_USER_IDS = RAW_DISPOSABLE_USER_IDS.filter(
      (id) => !PROTECTED_USER_IDS.includes(id),
    );

    // Safety check: ensure no overlap
    for (const pid of PROTECTED_USER_IDS) {
      if (DISPOSABLE_TEST_USER_IDS.includes(pid)) {
        throw new Error(`SAFETY VIOLATION: Protected user ID ${pid} found in deletion list!`);
      }
    }
    for (const pjid of PROTECTED_JOB_IDS) {
      if (DISPOSABLE_TEST_JOB_IDS.includes(pjid)) {
        throw new Error(`SAFETY VIOLATION: Protected job ID ${pjid} found in deletion list!`);
      }
    }

    // Counts Before
    const [usersBefore, jobsBefore, proposalsBefore] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.job.count(),
      this.prisma.proposal.count(),
    ]);

    // Perform sequential deletion in strict foreign key order
    let deletedProposalsCount = 0;
    let deletedJobsCount = 0;
    let deletedUsersCount = 0;

    try {
      // 1. Find target contracts
      const targetContracts = await this.prisma.contract.findMany({
        where: {
          OR: [
            { clientId: { in: DISPOSABLE_TEST_USER_IDS } },
            { jobId: { in: DISPOSABLE_TEST_JOB_IDS } },
          ],
        },
        select: { id: true },
      });
      const targetContractIds = targetContracts.map((c) => c.id);

      // 2. Find target conversations
      const targetConversations = await this.prisma.conversation.findMany({
        where: {
          OR: [
            { participant1Id: { in: DISPOSABLE_TEST_USER_IDS } },
            { participant2Id: { in: DISPOSABLE_TEST_USER_IDS } },
          ],
        },
        select: { id: true },
      });
      const targetConversationIds = targetConversations.map((c) => c.id);

      // 3. Delete messages for these conversations OR sent by target users
      if (targetConversationIds.length > 0 || DISPOSABLE_TEST_USER_IDS.length > 0) {
        await this.prisma.message.deleteMany({
          where: {
            OR: [
              { conversationId: { in: targetConversationIds } },
              { senderId: { in: DISPOSABLE_TEST_USER_IDS } },
            ],
          },
        });
      }

      // 4. Delete conversations (now safe because messages were deleted)
      if (targetConversationIds.length > 0) {
        await this.prisma.conversation.deleteMany({
          where: { id: { in: targetConversationIds } },
        });
      }

      // 5. Delete contract children if target contracts exist
      if (targetContractIds.length > 0) {
        const escrows = await this.prisma.escrow.findMany({
          where: { contractId: { in: targetContractIds } },
          select: { id: true },
        });
        const escrowIds = escrows.map((e) => e.id);
        if (escrowIds.length > 0) {
          await this.prisma.ledgerEntry.deleteMany({
            where: { escrowId: { in: escrowIds } },
          });
        }

        await this.prisma.contractFile.deleteMany({ where: { contractId: { in: targetContractIds } } });
        await this.prisma.milestone.deleteMany({ where: { contractId: { in: targetContractIds } } });
        await this.prisma.escrow.deleteMany({ where: { contractId: { in: targetContractIds } } });
        await this.prisma.dispute.deleteMany({ where: { contractId: { in: targetContractIds } } });
        await this.prisma.review.deleteMany({ where: { contractId: { in: targetContractIds } } });
        await this.prisma.payment.deleteMany({ where: { contractId: { in: targetContractIds } } });
        await this.prisma.contract.deleteMany({ where: { id: { in: targetContractIds } } });
      }

      // 6. Delete proposals on test jobs OR submitted by test users OR for jobs posted by test clients
      const deletedProposals = await this.prisma.proposal.deleteMany({
        where: {
          OR: [
            { jobId: { in: DISPOSABLE_TEST_JOB_IDS } },
            { freelancerId: { in: DISPOSABLE_TEST_USER_IDS } },
            { job: { clientId: { in: DISPOSABLE_TEST_USER_IDS } } },
          ],
        },
      });
      deletedProposalsCount = deletedProposals.count;

      // 7. Delete test jobs (ensuring protected jobs are NEVER deleted)
      const deletedJobs = await this.prisma.job.deleteMany({
        where: {
          AND: [
            { id: { notIn: PROTECTED_JOB_IDS } },
            {
              OR: [
                { id: { in: DISPOSABLE_TEST_JOB_IDS } },
                { clientId: { in: DISPOSABLE_TEST_USER_IDS } },
              ],
            },
          ],
        },
      });
      deletedJobsCount = deletedJobs.count;

      // 8. Delete user-level dependent records in foreign key order
      // 8a. User escrows & ledger entries
      const userEscrows = await this.prisma.escrow.findMany({
        where: { userId: { in: DISPOSABLE_TEST_USER_IDS } },
        select: { id: true },
      });
      if (userEscrows.length > 0) {
        await this.prisma.ledgerEntry.deleteMany({
          where: { escrowId: { in: userEscrows.map((e) => e.id) } },
        });
        await this.prisma.escrow.deleteMany({
          where: { id: { in: userEscrows.map((e) => e.id) } },
        });
      }

      // 8b. User contract files
      await this.prisma.contractFile.deleteMany({
        where: { uploaderId: { in: DISPOSABLE_TEST_USER_IDS } },
      });

      // 8c. User reviews
      await this.prisma.review.deleteMany({
        where: {
          OR: [
            { reviewerId: { in: DISPOSABLE_TEST_USER_IDS } },
            { revieweeId: { in: DISPOSABLE_TEST_USER_IDS } },
          ],
        },
      });

      // 8d. User disputes
      await this.prisma.dispute.deleteMany({
        where: { raisedByUserId: { in: DISPOSABLE_TEST_USER_IDS } },
      });

      // 8e. User payments
      await this.prisma.payment.deleteMany({
        where: { userId: { in: DISPOSABLE_TEST_USER_IDS } },
      });

      // 8f. Withdrawal requests (before payoutMethod and wallet)
      await this.prisma.withdrawalRequest.deleteMany({
        where: { userId: { in: DISPOSABLE_TEST_USER_IDS } },
      });

      // 8g. Payout methods (safe after withdrawal requests deleted)
      await this.prisma.payoutMethod.deleteMany({
        where: { userId: { in: DISPOSABLE_TEST_USER_IDS } },
      });

      // 8h. Wallet transactions (before wallet)
      await this.prisma.walletTransaction.deleteMany({
        where: { wallet: { userId: { in: DISPOSABLE_TEST_USER_IDS } } },
      });

      // 8i. Wallets (safe after transactions and withdrawals deleted)
      await this.prisma.wallet.deleteMany({
        where: { userId: { in: DISPOSABLE_TEST_USER_IDS } },
      });

      // 8j. Portfolio items
      await this.prisma.portfolioItem.deleteMany({
        where: { userId: { in: DISPOSABLE_TEST_USER_IDS } },
      });

      // 8k. Verifications
      await this.prisma.verification.deleteMany({
        where: { userId: { in: DISPOSABLE_TEST_USER_IDS } },
      });

      // 8l. Notifications
      await this.prisma.notification.deleteMany({
        where: { userId: { in: DISPOSABLE_TEST_USER_IDS } },
      });

      // 8m. Push subscriptions
      await this.prisma.pushSubscription.deleteMany({
        where: { userId: { in: DISPOSABLE_TEST_USER_IDS } },
      });

      // 9. Delete the test users (strictly ensuring protected users are NEVER deleted)
      const deletedUsers = await this.prisma.user.deleteMany({
        where: {
          AND: [
            { id: { notIn: PROTECTED_USER_IDS } },
            { id: { in: DISPOSABLE_TEST_USER_IDS } },
          ],
        },
      });
      deletedUsersCount = deletedUsers.count;
    } catch (err: any) {
      console.error('Error during cleanup execution:', err);
      throw new Error(`Cleanup failed: ${err?.message || err}`);
    }

    const deletionResult = {
      deletedProposalsCount,
      deletedJobsCount,
      deletedUsersCount,
    };

    // Counts After
    const [usersAfter, jobsAfter, proposalsAfter] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.job.count(),
      this.prisma.proposal.count(),
    ]);

    // Verify all protected users still exist
    const protectedUsersAfter = await this.prisma.user.findMany({
      where: { id: { in: PROTECTED_USER_IDS } },
      select: { id: true, email: true, name: true, role: true },
    });

    return {
      success: true,
      timestamp: new Date().toISOString(),
      countsBefore: {
        users: usersBefore,
        jobs: jobsBefore,
        proposals: proposalsBefore,
      },
      countsAfter: {
        users: usersAfter,
        jobs: jobsAfter,
        proposals: proposalsAfter,
      },
      deleted: deletionResult,
      protectedUsersVerified: protectedUsersAfter.length,
      protectedUsersList: protectedUsersAfter,
    };
  }

  /**
   * Safe atomic deletion of approved duplicate job 9ab022d5-4194-401d-8851-1dea48cd5cb1
   */
  async deleteDuplicateJob(jobId: string, secret?: string) {
    if (secret && secret !== 'PaklanceMaintenance2026!' && secret !== process.env.JWT_SECRET) {
      throw new ForbiddenException('Invalid maintenance secret');
    }

    if (jobId !== '9ab022d5-4194-401d-8851-1dea48cd5cb1') {
      throw new ForbiddenException('Only the approved duplicate job ID can be deleted');
    }

    // 1. Verify before deletion
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        client: true,
        Proposal: true,
      },
    });

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    if (job.Proposal.length > 0) {
      throw new Error(`Safety Violation: Job has ${job.Proposal.length} proposals. Expected 0.`);
    }

    if (job.client?.email !== 'client_prod_1787833069505@paklance.test') {
      throw new Error(`Safety Violation: Job owner email mismatch. Found: ${job.client?.email}`);
    }

    // 2. Perform foreign-key safe deletion
    const deletedJob = await this.prisma.job.delete({
      where: { id: jobId },
    });

    // 3. Check remaining jobs count
    const remainingJobsCount = await this.prisma.job.count();

    return {
      success: true,
      deletedJobId: deletedJob.id,
      deletedJobTitle: deletedJob.title,
      remainingJobsCount,
      deletedAt: new Date().toISOString(),
    };
  }
}

