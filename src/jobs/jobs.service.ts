import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJobDto, QueryJobDto, UpdateJobDto } from './dto/job.dto';

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clientId: string, dto: CreateJobDto) {
    const paymentMethod = (dto.paymentMethod || 'FIXED').toUpperCase();
    let calculatedBudget = Number(dto.budget) || 0;

    if (paymentMethod === 'HOURLY') {
      calculatedBudget =
        Number(dto.budget) ||
        Number(dto.hourlyMax) ||
        Number(dto.hourlyMin) ||
        0;
    } else if (paymentMethod === 'WEEKLY') {
      calculatedBudget = Number(dto.budget) || Number(dto.weeklyRate) || 0;
    } else if (paymentMethod === 'MONTHLY') {
      calculatedBudget = Number(dto.budget) || Number(dto.monthlyRate) || 0;
    }

    let skillsArray: string[] = [];
    if (Array.isArray(dto.skills)) {
      skillsArray = dto.skills.map((s) => String(s).trim()).filter(Boolean);
    } else if (typeof dto.skills === 'string') {
      skillsArray = dto.skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const duration =
      dto.duration ||
      (dto.deliveryDays ? `${dto.deliveryDays} days` : null);

    return this.prisma.job.create({
      data: {
        title: dto.title.trim(),
        description: dto.description.trim(),
        budget: calculatedBudget,
        category: dto.category ? dto.category.trim() : null,
        skills: skillsArray,
        jobType: (dto.jobType || 'FREELANCE').toUpperCase(),
        paymentMethod,
        hourlyMin:
          dto.hourlyMin !== undefined && dto.hourlyMin !== null
            ? Number(dto.hourlyMin)
            : null,
        hourlyMax:
          dto.hourlyMax !== undefined && dto.hourlyMax !== null
            ? Number(dto.hourlyMax)
            : null,
        weeklyHours:
          dto.weeklyHours !== undefined && dto.weeklyHours !== null
            ? Number(dto.weeklyHours)
            : null,
        weeklyRate:
          dto.weeklyRate !== undefined && dto.weeklyRate !== null
            ? Number(dto.weeklyRate)
            : null,
        monthlyRate:
          dto.monthlyRate !== undefined && dto.monthlyRate !== null
            ? Number(dto.monthlyRate)
            : null,
        currency: (dto.currency || 'PKR').toUpperCase(),
        deliveryDays:
          dto.deliveryDays !== undefined && dto.deliveryDays !== null
            ? Number(dto.deliveryDays)
            : null,
        duration,
        experienceLevel: (dto.experienceLevel || 'INTERMEDIATE').toUpperCase(),
        locationType: (dto.locationType || 'REMOTE').toUpperCase(),
        location: dto.location ? dto.location.trim() : null,
        safepay: Boolean(dto.safepay),
        status: 'OPEN',
        clientId,
      },
      include: {
        client: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
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
    });
  }

  async findAll(query: QueryJobDto) {
    const where: any = {};

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { category: { contains: term, mode: 'insensitive' } },
      ];
    }

    if (query.jobType && query.jobType !== 'all') {
      where.jobType = { equals: query.jobType.toUpperCase() };
    }

    if (query.paymentMethod && query.paymentMethod !== 'all') {
      where.paymentMethod = { equals: query.paymentMethod.toUpperCase() };
    }

    if (query.category && query.category !== 'all') {
      where.category = { contains: query.category, mode: 'insensitive' };
    }

    if (query.skills && query.skills.trim()) {
      const skillTerm = query.skills.trim();
      where.skills = { has: skillTerm };
    }

    if (query.minBudget !== undefined || query.maxBudget !== undefined) {
      where.budget = {};
      if (query.minBudget !== undefined) where.budget.gte = query.minBudget;
      if (query.maxBudget !== undefined) where.budget.lte = query.maxBudget;
    }

    if (query.minHourly !== undefined || query.maxHourly !== undefined) {
      if (query.minHourly !== undefined) {
        where.hourlyMin = { gte: query.minHourly };
      }
      if (query.maxHourly !== undefined) {
        where.hourlyMax = { lte: query.maxHourly };
      }
    }

    if (query.locationType && query.locationType !== 'all') {
      where.locationType = { equals: query.locationType.toUpperCase() };
    }

    if (query.experienceLevel && query.experienceLevel !== 'all') {
      where.experienceLevel = { equals: query.experienceLevel.toUpperCase() };
    }

    if (query.safepay === true || query.safepay === 'true') {
      where.safepay = true;
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
      // Allow if admin
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.role !== 'ADMIN') {
        throw new ForbiddenException('You can only update your own job posts');
      }
    }

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description.trim();
    if (dto.category !== undefined) data.category = dto.category ? dto.category.trim() : null;
    if (dto.jobType !== undefined) data.jobType = dto.jobType.toUpperCase();
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod.toUpperCase();
    if (dto.hourlyMin !== undefined) data.hourlyMin = dto.hourlyMin !== null ? Number(dto.hourlyMin) : null;
    if (dto.hourlyMax !== undefined) data.hourlyMax = dto.hourlyMax !== null ? Number(dto.hourlyMax) : null;
    if (dto.weeklyHours !== undefined) data.weeklyHours = dto.weeklyHours !== null ? Number(dto.weeklyHours) : null;
    if (dto.weeklyRate !== undefined) data.weeklyRate = dto.weeklyRate !== null ? Number(dto.weeklyRate) : null;
    if (dto.monthlyRate !== undefined) data.monthlyRate = dto.monthlyRate !== null ? Number(dto.monthlyRate) : null;
    if (dto.currency !== undefined) data.currency = dto.currency.toUpperCase();
    if (dto.deliveryDays !== undefined) data.deliveryDays = dto.deliveryDays !== null ? Number(dto.deliveryDays) : null;
    if (dto.duration !== undefined) data.duration = dto.duration;
    if (dto.experienceLevel !== undefined) data.experienceLevel = dto.experienceLevel.toUpperCase();
    if (dto.locationType !== undefined) data.locationType = dto.locationType.toUpperCase();
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.safepay !== undefined) data.safepay = Boolean(dto.safepay);
    if (dto.status !== undefined) data.status = dto.status.toUpperCase();

    if (dto.budget !== undefined) {
      data.budget = Number(dto.budget);
    } else if (dto.paymentMethod === 'HOURLY' && (dto.hourlyMax || dto.hourlyMin)) {
      data.budget = Number(dto.hourlyMax || dto.hourlyMin);
    } else if (dto.paymentMethod === 'WEEKLY' && dto.weeklyRate) {
      data.budget = Number(dto.weeklyRate);
    } else if (dto.paymentMethod === 'MONTHLY' && dto.monthlyRate) {
      data.budget = Number(dto.monthlyRate);
    }

    if (dto.skills !== undefined) {
      if (Array.isArray(dto.skills)) {
        data.skills = dto.skills.map((s) => String(s).trim()).filter(Boolean);
      } else if (typeof dto.skills === 'string') {
        data.skills = dto.skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }

    return this.prisma.job.update({
      where: { id },
      data,
      include: {
        client: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            city: true,
            country: true,
            isEmailVerified: true,
            verification: { select: { status: true } },
          },
        },
        _count: { select: { Proposal: true } },
      },
    });
  }

  async remove(id: string, userId: string) {
    const job = await this.findOne(id);
    if (job.clientId !== userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.role !== 'ADMIN') {
        throw new ForbiddenException('You can only delete your own job posts');
      }
    }

    return this.prisma.job.delete({ where: { id } });
  }
}
