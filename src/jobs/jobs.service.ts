import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJobDto, QueryJobDto, UpdateJobDto } from './dto/job.dto';

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clientId: string, dto: CreateJobDto) {
    let description = (dto.description || '').trim();
    if (dto.category && !description.toLowerCase().includes('category:')) {
      description += `\n\nCategory: ${dto.category}`;
    }
    if (dto.skills && !description.toLowerCase().includes('skills:')) {
      const skillsStr = Array.isArray(dto.skills) ? dto.skills.join(', ') : String(dto.skills);
      if (skillsStr.trim()) {
        description += `\nRequired Skills: ${skillsStr.trim()}`;
      }
    }
    if (dto.deliveryDays && !description.toLowerCase().includes('timeline:') && !description.toLowerCase().includes('delivery:')) {
      description += `\nDelivery Timeline: ${dto.deliveryDays} days`;
    }

    return this.prisma.job.create({
      data: {
        title: dto.title,
        description,
        budget: dto.budget,
        clientId,
      },
      include: {
        client: {
          select: { id: true, email: true, name: true, role: true },
        },
      },
    });
  }

  async findAll(query: QueryJobDto) {
    const where: any = {};

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.minBudget !== undefined || query.maxBudget !== undefined) {
      where.budget = {};
      if (query.minBudget !== undefined) where.budget.gte = query.minBudget;
      if (query.maxBudget !== undefined) where.budget.lte = query.maxBudget;
    }

    if (query.clientId) {
      where.clientId = query.clientId;
    }

    return this.prisma.job.findMany({
      where,
      include: {
        client: {
          select: {
            id: true,
            email: true,
            name: true,
            city: true,
            country: true,
            isEmailVerified: true,
            verification: { select: { status: true } },
          },
        },
        _count: {
          select: { Proposal: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        client: {
          select: {
            id: true,
            email: true,
            name: true,
            city: true,
            country: true,
            isEmailVerified: true,
            verification: { select: { status: true } },
          },
        },
        contracts: true,
        _count: {
          select: { Proposal: true },
        },
      },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    return job;
  }

  async update(id: string, userId: string, dto: UpdateJobDto) {
    const job = await this.findOne(id);
    if (job.clientId !== userId) {
      throw new ForbiddenException('You can only update your own job posts');
    }

    return this.prisma.job.update({
      where: { id },
      data: { ...dto },
      include: {
        client: { select: { id: true, email: true, name: true } },
        _count: { select: { Proposal: true } },
      },
    });
  }

  async remove(id: string, userId: string) {
    const job = await this.findOne(id);
    if (job.clientId !== userId) {
      throw new ForbiddenException('You can only delete your own job posts');
    }

    return this.prisma.job.delete({ where: { id } });
  }
}
