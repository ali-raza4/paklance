import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { CreateContractDto, UploadContractFileDto } from './dto/contract.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Contracts & Escrow')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @ApiOperation({
    summary: 'Create new Contract with Milestones (CLIENT only)',
  })
  @Roles(Role.CLIENT)
  @Post()
  createContract(
    @CurrentUser('id') clientId: string,
    @Body() dto: CreateContractDto,
  ) {
    return this.contractsService.createContract(clientId, dto);
  }

  @ApiOperation({ summary: 'Fund contract Escrow (CLIENT only)' })
  @Roles(Role.CLIENT)
  @Post(':id/fund')
  fundContract(
    @Param('id') contractId: string,
    @CurrentUser('id') clientId: string,
    @Body('amount') amount: number,
  ) {
    return this.contractsService.fundContract(contractId, clientId, amount);
  }

  @ApiOperation({
    summary: 'Release Milestone funds to Specialist (CLIENT only)',
  })
  @Roles(Role.CLIENT, Role.ADMIN)
  @Patch('milestones/:milestoneId/release')
  releaseMilestone(
    @Param('milestoneId') milestoneId: string,
    @CurrentUser('id') clientId: string,
  ) {
    return this.contractsService.releaseMilestone(milestoneId, clientId);
  }

  @ApiOperation({ summary: 'Submit milestone work (SPECIALIST only)' })
  @Roles(Role.SPECIALIST)
  @Post(':id/milestones/:milestoneId/submit')
  submitMilestone(
    @Param('id') contractId: string,
    @Param('milestoneId') milestoneId: string,
    @CurrentUser('id') specialistId: string,
  ) {
    return this.contractsService.submitMilestone(
      contractId,
      milestoneId,
      specialistId,
    );
  }

  @ApiOperation({
    summary: 'Approve milestone and release funds (CLIENT only)',
  })
  @Roles(Role.CLIENT, Role.ADMIN)
  @Post(':id/milestones/:milestoneId/approve')
  approveMilestone(
    @Param('id') contractId: string,
    @Param('milestoneId') milestoneId: string,
    @CurrentUser('id') clientId: string,
  ) {
    return this.contractsService.approveMilestone(
      contractId,
      milestoneId,
      clientId,
    );
  }

  @ApiOperation({ summary: 'Get all user contracts (Client or Specialist)' })
  @Roles(Role.CLIENT, Role.SPECIALIST, Role.ADMIN)
  @Get()
  findUserContracts(@CurrentUser('id') userId: string) {
    return this.contractsService.findUserContracts(userId);
  }

  @ApiOperation({ summary: 'Get files for a contract' })
  @Roles(Role.CLIENT, Role.SPECIALIST, Role.ADMIN)
  @Get(':id/files')
  getContractFiles(
    @Param('id') contractId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.contractsService.getContractFiles(userId, contractId);
  }

  @ApiOperation({ summary: 'Upload file to contract' })
  @Roles(Role.CLIENT, Role.SPECIALIST, Role.ADMIN)
  @Post(':id/files')
  uploadContractFile(
    @Param('id') contractId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UploadContractFileDto,
  ) {
    return this.contractsService.uploadContractFile(userId, contractId, {
      originalname: dto.filename,
      mimetype: dto.mimeType,
      size: dto.size,
      fileData: dto.fileData,
    });
  }

  @ApiOperation({ summary: 'Get specific contract file' })
  @Roles(Role.CLIENT, Role.SPECIALIST, Role.ADMIN)
  @Get(':id/files/:fileId')
  getContractFile(
    @Param('id') contractId: string,
    @Param('fileId') fileId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.contractsService.getContractFile(userId, contractId, fileId);
  }

  @ApiOperation({ summary: 'Get a single contract by ID' })
  @Roles(Role.CLIENT, Role.SPECIALIST, Role.ADMIN)
  @Get(':id')
  findOne(@Param('id') contractId: string) {
    return this.contractsService.findOne(contractId);
  }

  @ApiOperation({
    summary: 'Start contract work (SPECIALIST only — contract must be FUNDED)',
  })
  @Roles(Role.SPECIALIST)
  @Patch(':id/start')
  startContract(
    @Param('id') contractId: string,
    @CurrentUser('id') specialistId: string,
  ) {
    return this.contractsService.startContract(contractId, specialistId);
  }

  @ApiOperation({
    summary: 'Mark contract as complete (CLIENT only — must be IN_PROGRESS)',
  })
  @Roles(Role.CLIENT)
  @Patch(':id/complete')
  completeContract(
    @Param('id') contractId: string,
    @CurrentUser('id') clientId: string,
  ) {
    return this.contractsService.completeContract(contractId, clientId);
  }

  @ApiOperation({
    summary:
      'Close contract (CLIENT or SPECIALIST — must be COMPLETED or DISPUTED)',
  })
  @Roles(Role.CLIENT, Role.SPECIALIST)
  @Patch(':id/close')
  closeContract(
    @Param('id') contractId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.contractsService.closeContract(contractId, userId);
  }
}
