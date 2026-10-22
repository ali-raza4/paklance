import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletService } from './wallet.service';
import { DepositDto } from './dto/deposit.dto';
import { WithdrawDto } from './dto/withdraw.dto';

@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @ApiOperation({ summary: 'Get wallet balance (total, locked, available)' })
  @Get('balance')
  getBalance(@Req() req: Request) {
    const userId = (req as any).user.id;
    return this.walletService.getBalance(userId);
  }

  @ApiOperation({ summary: 'Get role-specific wallet & financial dashboard summary' })
  @Get('summary')
  getSummary(@Req() req: Request) {
    const user = (req as any).user;
    return this.walletService.getSummary(user.id, user.role);
  }

  @ApiOperation({ summary: 'Deposit funds into wallet' })
  @Post('deposit')
  deposit(@Req() req: Request, @Body() dto: DepositDto) {
    const userId = (req as any).user.id;
    return this.walletService.deposit(userId, dto);
  }

  @ApiOperation({ summary: 'Submit a withdrawal request' })
  @Post('withdraw')
  withdraw(@Req() req: Request, @Body() dto: WithdrawDto) {
    const userId = (req as any).user.id;
    return this.walletService.withdraw(userId, dto);
  }

  @ApiOperation({ summary: 'Get user withdrawal request history' })
  @Get('withdrawals')
  getUserWithdrawals(@Req() req: Request) {
    const userId = (req as any).user.id;
    return this.walletService.getUserWithdrawals(userId);
  }

  @ApiOperation({ summary: 'Cancel a pending withdrawal request' })
  @Post('withdrawals/:id/cancel')
  cancelWithdrawal(@Req() req: Request, @Param('id') id: string) {
    const userId = (req as any).user.id;
    return this.walletService.cancelWithdrawal(userId, id);
  }

  @ApiOperation({ summary: 'Get wallet transaction history' })
  @Get('transactions')
  getTransactionHistory(@Req() req: Request) {
    const userId = (req as any).user.id;
    return this.walletService.getTransactionHistory(userId);
  }

  @ApiOperation({ summary: 'Download or export wallet statement in CSV format' })
  @Get('statement')
  exportStatement(@Req() req: Request) {
    const userId = (req as any).user.id;
    return this.walletService.exportStatement(userId);
  }
}
