import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ProposalsService } from './proposals.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { UpdateProposalStatusDto } from './dto/update-proposal-status.dto';

@ApiTags('Proposals')
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SPECIALIST)
  @Post()
  submitProposal(@Req() req: Request, @Body() dto: CreateProposalDto) {
    const userId = (req as any).user.id;
    return this.proposalsService.submitProposal(userId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyProposals(@Req() req: Request) {
    const userId = (req as any).user.id;
    return this.proposalsService.getMyProposals(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('client')
  getClientProposals(@Req() req: Request) {
    const userId = (req as any).user.id;
    return this.proposalsService.getClientProposals(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('job/:jobId')
  getProposalsByJob(@Req() req: Request, @Param('jobId') jobId: string) {
    const userId = (req as any).user.id;
    return this.proposalsService.getProposalsByJob(userId, jobId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CLIENT, Role.ADMIN)
  @Patch(':id/accept')
  acceptProposal(@Req() req: Request, @Param('id') id: string) {
    const userId = (req as any).user.id;
    return this.proposalsService.acceptProposal(userId, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CLIENT, Role.ADMIN)
  @Patch(':id/reject')
  rejectProposal(@Req() req: Request, @Param('id') id: string) {
    const userId = (req as any).user.id;
    return this.proposalsService.rejectProposal(userId, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CLIENT, Role.ADMIN)
  @Patch(':id/status')
  updateStatus(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateProposalStatusDto,
  ) {
    const userId = (req as any).user.id;
    return this.proposalsService.updateStatus(userId, id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SPECIALIST)
  @Delete(':id')
  withdrawProposal(@Req() req: Request, @Param('id') id: string) {
    const userId = (req as any).user.id;
    return this.proposalsService.withdrawProposal(userId, id);
  }
}
