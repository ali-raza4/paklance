import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { JobsModule } from './jobs/jobs.module';
import { ContractsModule } from './contracts/contracts.module';
import { StorageModule } from './storage/storage.module';
import { UploadsModule } from './uploads/uploads.module';
import { ProfilesModule } from './profiles/profiles.module';
import { ProposalsModule } from './proposals/proposals.module';
import { ReviewsModule } from './reviews/reviews.module';
import { DisputesModule } from './disputes/disputes.module';
import { VerificationModule } from './verification/verification.module';
import { MessagingModule } from './messaging/messaging.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WalletModule } from './wallet/wallet.module';
import { MatchingModule } from './matching/matching.module';
import { AdminModule } from './admin/admin.module';
import { PaymentsModule } from './payments/payments.module';
import { PushModule } from './push/push.module';
import { MeModule } from './me/me.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    UsersModule,
    AuthModule,
    JobsModule,
    ContractsModule,
    StorageModule,
    UploadsModule,
    ProfilesModule,
    ProposalsModule,
    ReviewsModule,
    DisputesModule,
    VerificationModule,
    MessagingModule,
    NotificationsModule,
    WalletModule,
    MatchingModule,
    AdminModule,
    PaymentsModule,
    PushModule,
    MeModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

