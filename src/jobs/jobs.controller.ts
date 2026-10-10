import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { ProposalsService } from '../proposals/proposals.service';
import { CreateJobDto, QueryJobDto, UpdateJobDto } from './dto/job.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Jobs')
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly proposalsService: ProposalsService,
  ) {}

  @ApiOperation({ summary: 'Submit a proposal to a job (SPECIALIST only)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SPECIALIST)
  @Post(':id/proposals')
  async submitProposal(
    @CurrentUser('id') userId: string,
    @Param('id') jobId: string,
    @Body() body: any,
  ) {
    const job = await this.jobsService.findOne(jobId);
    return this.proposalsService.submitProposal(userId, {
      jobId,
      coverLetter:
        (body && body.coverLetter) ||
        'I am interested in this project and ready to deliver quality work.',
      bidAmount:
        Number(body && body.bidAmount) || Number(job.budget) || 1000,
      deliveryDays: Number(body && body.deliveryDays) || 7,
    });
  }

  @ApiOperation({ summary: 'Get proposals on a job (Owner CLIENT or ADMIN)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id/proposals')
  async getJobProposals(
    @CurrentUser('id') userId: string,
    @Param('id') jobId: string,
  ) {
    return this.proposalsService.getProposalsByJob(userId, jobId);
  }

  @ApiOperation({ summary: 'Accept proposal on a job (Owner CLIENT or ADMIN)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CLIENT, Role.ADMIN)
  @Patch(':jobId/proposals/:proposalId/accept')
  async acceptJobProposal(
    @CurrentUser('id') userId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.proposalsService.acceptProposal(userId, proposalId);
  }

  @ApiOperation({ summary: 'Post a new job (CLIENT only)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CLIENT, Role.ADMIN)
  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() createJobDto: CreateJobDto,
  ) {
    return this.jobsService.create(userId, createJobDto);
  }

  @ApiOperation({ summary: 'Browse/Search jobs with filters' })
  @Get()
  findAll(@Query() query: QueryJobDto) {
    return this.jobsService.findAll(query);
  }

  @ApiOperation({ summary: 'Get single job details' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jobsService.findOne(id);
  }

  @ApiOperation({ summary: 'Update a job post (Owner CLIENT only)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CLIENT)
  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() updateJobDto: UpdateJobDto,
  ) {
    return this.jobsService.update(id, userId, updateJobDto);
  }

  @ApiOperation({ summary: 'Delete a job post (Owner CLIENT or ADMIN)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CLIENT, Role.ADMIN)
  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.jobsService.remove(id, userId);
  }
}
