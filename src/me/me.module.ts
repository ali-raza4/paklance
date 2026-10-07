import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MeController } from './me.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    ProfilesModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback_secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [MeController],
})
export class MeModule {}
