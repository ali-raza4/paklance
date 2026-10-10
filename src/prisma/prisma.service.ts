import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private static migrationPromise: Promise<void> | null = null;

  async onModuleInit() {
    await this.$connect();
    await this.ensureSchemaMigrated();
  }

  async ensureSchemaMigrated() {
    if (PrismaService.migrationPromise) return PrismaService.migrationPromise;
    PrismaService.migrationPromise = (async () => {
      const sqlQueries = [
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT DEFAULT '';`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "role" TEXT DEFAULT 'SPECIALIST';`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "isEmailVerified" BOOLEAN DEFAULT false;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "emailVerifyOtp" TEXT;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "emailVerifyExpires" TIMESTAMP(3);`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "emailVerifyLastSentAt" TIMESTAMP(3);`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "resetPasswordToken" TEXT;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "resetPasswordExpires" TIMESTAMP(3);`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "resetPasswordLastSentAt" TIMESTAMP(3);`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT DEFAULT '';`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "role" TEXT DEFAULT 'SPECIALIST';`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "isEmailVerified" BOOLEAN DEFAULT false;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "emailVerifyOtp" TEXT;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "emailVerifyExpires" TIMESTAMP(3);`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "emailVerifyLastSentAt" TIMESTAMP(3);`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "resetPasswordToken" TEXT;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "resetPasswordExpires" TIMESTAMP(3);`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "resetPasswordLastSentAt" TIMESTAMP(3);`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
        `DO $$ BEGIN CREATE TYPE "PaymentProvider" AS ENUM ('JAZZCASH', 'EASYPAISA', 'RAAST', 'BANK_TRANSFER', 'SANDBOX'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
        `DO $$ BEGIN CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED', 'TIMEOUT', 'MISMATCHED'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
        `DO $$ BEGIN CREATE TYPE "PayoutType" AS ENUM ('BANK', 'JAZZCASH', 'EASYPAISA', 'RAAST'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
        `DO $$ BEGIN CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "skills" TEXT[] DEFAULT ARRAY[]::TEXT[];`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "headline" TEXT;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "bio" TEXT;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "city" TEXT;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "country" TEXT;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "hourlyRate" DECIMAL(65,30);`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "videoKind" TEXT;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "videoUrl" TEXT;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "videoName" TEXT;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "videoSize" BIGINT;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "videoType" TEXT;`,
        `ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "videoDuration" INTEGER;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "skills" TEXT[] DEFAULT ARRAY[]::TEXT[];`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "headline" TEXT;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "bio" TEXT;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "city" TEXT;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "country" TEXT;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "hourlyRate" DECIMAL(65,30);`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "videoKind" TEXT;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "videoUrl" TEXT;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "videoName" TEXT;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "videoSize" BIGINT;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "videoType" TEXT;`,
        `ALTER TABLE IF EXISTS "user" ADD COLUMN IF NOT EXISTS "videoDuration" INTEGER;`,
        `ALTER TABLE IF EXISTS "PortfolioItem" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'portfolio';`,
        `ALTER TABLE IF EXISTS "PortfolioItem" ADD COLUMN IF NOT EXISTS "subtitle" TEXT;`,
        `ALTER TABLE IF EXISTS "PortfolioItem" ADD COLUMN IF NOT EXISTS "url" TEXT;`,
        `ALTER TABLE IF EXISTS "PortfolioItem" ADD COLUMN IF NOT EXISTS "amount" DECIMAL(65,30);`,
        `ALTER TABLE IF EXISTS "PortfolioItem" ADD COLUMN IF NOT EXISTS "startYear" INTEGER;`,
        `ALTER TABLE IF EXISTS "PortfolioItem" ADD COLUMN IF NOT EXISTS "endYear" INTEGER;`,
        `ALTER TABLE IF EXISTS "portfolioitem" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'portfolio';`,
        `ALTER TABLE IF EXISTS "portfolioitem" ADD COLUMN IF NOT EXISTS "subtitle" TEXT;`,
        `ALTER TABLE IF EXISTS "portfolioitem" ADD COLUMN IF NOT EXISTS "url" TEXT;`,
        `ALTER TABLE IF EXISTS "portfolioitem" ADD COLUMN IF NOT EXISTS "amount" DECIMAL(65,30);`,
        `ALTER TABLE IF EXISTS "portfolioitem" ADD COLUMN IF NOT EXISTS "startYear" INTEGER;`,
        `ALTER TABLE IF EXISTS "portfolioitem" ADD COLUMN IF NOT EXISTS "endYear" INTEGER;`,
        `ALTER TABLE IF EXISTS "Message" ADD COLUMN IF NOT EXISTS "isDelivered" BOOLEAN NOT NULL DEFAULT false;`,
        `ALTER TABLE IF EXISTS "message" ADD COLUMN IF NOT EXISTS "isDelivered" BOOLEAN NOT NULL DEFAULT false;`,
        `ALTER TABLE IF EXISTS "Wallet" ADD COLUMN IF NOT EXISTS "lockedBalance" DECIMAL(65,30) NOT NULL DEFAULT 0;`,
        `ALTER TABLE IF EXISTS "wallet" ADD COLUMN IF NOT EXISTS "lockedBalance" DECIMAL(65,30) NOT NULL DEFAULT 0;`,
        `CREATE TABLE IF NOT EXISTS "ContractFile" (
            "id" TEXT NOT NULL,
            "contractId" TEXT NOT NULL,
            "uploaderId" TEXT NOT NULL,
            "filename" TEXT NOT NULL,
            "originalName" TEXT NOT NULL,
            "fileSize" INTEGER NOT NULL,
            "mimeType" TEXT NOT NULL,
            "fileData" TEXT NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "ContractFile_pkey" PRIMARY KEY ("id")
        );`,
        `CREATE TABLE IF NOT EXISTS "Payment" (
            "id" TEXT NOT NULL,
            "contractId" TEXT,
            "userId" TEXT NOT NULL,
            "amount" DECIMAL(65,30) NOT NULL,
            "currency" TEXT NOT NULL DEFAULT 'PKR',
            "provider" "PaymentProvider" NOT NULL,
            "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
            "referenceId" TEXT NOT NULL,
            "gatewayTxnId" TEXT,
            "gatewayResponse" JSONB,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
        );`,
        `CREATE TABLE IF NOT EXISTS "PaymentWebhookLog" (
            "id" TEXT NOT NULL,
            "provider" "PaymentProvider" NOT NULL,
            "eventType" TEXT,
            "referenceId" TEXT,
            "payload" JSONB NOT NULL,
            "headers" JSONB,
            "signatureValid" BOOLEAN NOT NULL,
            "processed" BOOLEAN NOT NULL DEFAULT false,
            "error" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "PaymentWebhookLog_pkey" PRIMARY KEY ("id")
        );`,
        `CREATE TABLE IF NOT EXISTS "PayoutMethod" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "type" "PayoutType" NOT NULL,
            "accountTitle" TEXT NOT NULL,
            "accountNumber" TEXT NOT NULL,
            "bankName" TEXT,
            "isDefault" BOOLEAN NOT NULL DEFAULT false,
            "isVerified" BOOLEAN NOT NULL DEFAULT true,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "PayoutMethod_pkey" PRIMARY KEY ("id")
        );`,
        `CREATE TABLE IF NOT EXISTS "WithdrawalRequest" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "walletId" TEXT NOT NULL,
            "payoutMethodId" TEXT,
            "amount" DECIMAL(65,30) NOT NULL,
            "fee" DECIMAL(65,30) NOT NULL DEFAULT 0,
            "netAmount" DECIMAL(65,30) NOT NULL,
            "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
            "referenceId" TEXT NOT NULL,
            "payoutMethodSnapshot" JSONB NOT NULL,
            "adminNote" TEXT,
            "failureReason" TEXT,
            "processedAt" TIMESTAMP(3),
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY ("id")
        );`,
        `CREATE TABLE IF NOT EXISTS "PushSubscription" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "endpoint" TEXT NOT NULL,
            "p256dh" TEXT NOT NULL,
            "auth" TEXT NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
        );`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "Payment_referenceId_key" ON "Payment"("referenceId");`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "WithdrawalRequest_referenceId_key" ON "WithdrawalRequest"("referenceId");`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");`,
        `DO $$ BEGIN CREATE TYPE "BlogStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
        `CREATE TABLE IF NOT EXISTS "BlogPost" (
            "id" TEXT NOT NULL,
            "title" TEXT NOT NULL,
            "slug" TEXT NOT NULL,
            "excerpt" TEXT,
            "content" TEXT NOT NULL,
            "coverImageUrl" TEXT,
            "category" TEXT NOT NULL DEFAULT 'Freelancing',
            "tags" TEXT[] NOT NULL DEFAULT '{}',
            "authorName" TEXT NOT NULL DEFAULT 'Paklance Editorial Team',
            "status" "BlogStatus" NOT NULL DEFAULT 'DRAFT',
            "metaTitle" TEXT,
            "metaDescription" TEXT,
            "publishedAt" TIMESTAMP(3),
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
        );`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "BlogPost_slug_key" ON "BlogPost"("slug");`,
        `ALTER TABLE IF EXISTS "BlogPost" ADD COLUMN IF NOT EXISTS "subtitle" TEXT;`,
        `ALTER TABLE IF EXISTS "blogpost" ADD COLUMN IF NOT EXISTS "subtitle" TEXT;`,
        `CREATE INDEX IF NOT EXISTS "BlogPost_status_idx" ON "BlogPost"("status");`,
        `CREATE INDEX IF NOT EXISTS "BlogPost_category_idx" ON "BlogPost"("category");`,
        `CREATE INDEX IF NOT EXISTS "BlogPost_publishedAt_idx" ON "BlogPost"("publishedAt");`
      ];
      for (const q of sqlQueries) {
        try {
          await this.$executeRawUnsafe(q);
        } catch (e) {
          // ignore individual statement errors
        }
      }
    })();
    return PrismaService.migrationPromise;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
