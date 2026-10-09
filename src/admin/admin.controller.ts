import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AdminService } from './admin.service';

@ApiTags('Admin Controls')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @ApiOperation({ summary: 'Get overall platform statistics' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @ApiOperation({ summary: 'Get all registered users' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('users')
  getAllUsers() {
    return this.adminService.getAllUsers();
  }

  @ApiOperation({ summary: 'Get user by ID' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('users/:id')
  getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @ApiOperation({ summary: 'Get all raised disputes' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('disputes')
  getAllDisputes() {
    return this.adminService.getAllDisputes();
  }

  @ApiOperation({ summary: 'Get all pending specialist verifications' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('verifications')
  getAllVerifications() {
    return this.adminService.getAllVerifications();
  }

  @ApiOperation({ summary: 'Get platform financial stats and balances' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('financials/stats')
  getFinancialStats() {
    return this.adminService.getFinancialStats();
  }

  @ApiOperation({ summary: 'Get all payments and transaction logs' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('financials/payments')
  getAllPayments() {
    return this.adminService.getAllPayments();
  }

  @ApiOperation({ summary: 'Get incoming gateway webhook audit logs' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('financials/webhooks')
  getAllWebhookLogs() {
    return this.adminService.getAllWebhookLogs();
  }

  @ApiOperation({ summary: 'Get all specialist withdrawal requests' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('financials/withdrawals')
  getAllWithdrawals() {
    return this.adminService.getAllWithdrawals();
  }

  @ApiOperation({
    summary: 'Process specialist withdrawal (PROCESSING, COMPLETED, FAILED)',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch('financials/withdrawals/:id/process')
  processWithdrawal(
    @Param('id') id: string,
    @Body('action') action: 'PROCESSING' | 'COMPLETED' | 'FAILED',
    @Body('adminNote') adminNote?: string,
  ) {
    return this.adminService.processWithdrawal(id, action, adminNote);
  }

  @ApiOperation({
    summary: 'Atomic cleanup of confirmed disposable test records with strict whitelist protection',
  })
  @Post('maintenance/cleanup-test-data')
  cleanupDisposableTestData(@Body('secret') secret?: string) {
    return this.adminService.cleanupDisposableTestData(secret);
  }

  @ApiOperation({
    summary: 'Delete verified duplicate job',
  })
  @Post('maintenance/delete-duplicate-job')
  deleteDuplicateJob(
    @Body('jobId') jobId: string,
    @Body('secret') secret?: string,
  ) {
    return this.adminService.deleteDuplicateJob(jobId, secret);
  }

}


