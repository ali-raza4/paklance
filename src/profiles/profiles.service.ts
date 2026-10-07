import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreatePortfolioItemDto } from './dto/create-portfolio-item.dto';
import { SearchProfilesDto } from './dto/search-profiles.dto';
import { Availability } from '@prisma/client';

/**
 * Whitelist of safe scalar user fields for API responses.
 * passwordHash is intentionally excluded and must NEVER appear here.
 * portfolioItems (relation) is added per-query using select: { portfolioItems: true }.
 */
const SAFE_SCALAR_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  headline: true,
  bio: true,
  skills: true,
  hourlyRate: true,
  availability: true,
  country: true,
  city: true,
  avatarUrl: true,
  createdAt: true,
  updatedAt: true,
};

/** Public-facing profile select — no email, no sensitive fields */
const PUBLIC_PROFILE_SELECT = {
  id: true,
  name: true,
  headline: true,
  bio: true,
  skills: true,
  hourlyRate: true,
  availability: true,
  country: true,
  city: true,
  avatarUrl: true,
};

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  private mapAvailability(val?: string): Availability | undefined {
    if (!val) return undefined;
    const v = String(val).toUpperCase().trim();
    if (
      v === 'AVAILABLE' ||
      v.includes('AVAILABLE') ||
      v.includes('NOW') ||
      v.includes('OPEN') ||
      v.includes('DEDICATED')
    ) {
      return Availability.AVAILABLE;
    }
    if (v === 'BUSY') return Availability.BUSY;
    if (v === 'UNAVAILABLE' || v === 'NOT_AVAILABLE' || v.includes('NOT')) return Availability.NOT_AVAILABLE;
    return Availability.AVAILABLE;
  }

  async getProfileByUserId(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...SAFE_SCALAR_SELECT,
        portfolioItems: true,
      },
    });
    if (!user) throw new NotFoundException('Profile not found');
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: any = {};

    const name = dto.name ?? dto.fullName;
    if (name !== undefined) data.name = name.trim();

    const bio = dto.bio ?? dto.about;
    if (bio !== undefined) data.bio = bio;

    if (dto.headline !== undefined) data.headline = dto.headline;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.skills !== undefined) data.skills = Array.isArray(dto.skills) ? dto.skills : [];

    const rate = dto.hourlyRate ?? dto.hourly_rate;
    if (rate !== undefined && !isNaN(Number(rate))) {
      data.hourlyRate = Number(rate);
    }

    const avatar = dto.avatarUrl ?? dto.photo;
    if (avatar !== undefined) data.avatarUrl = avatar;

    if (dto.availability !== undefined) {
      data.availability = this.mapAvailability(dto.availability);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        ...SAFE_SCALAR_SELECT,
        portfolioItems: true,
      },
    });
  }

  async searchProfiles(query: SearchProfilesDto) {
    const q = (query.q || query.search || '').trim();
    return this.prisma.user.findMany({
      where: {
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { headline: { contains: q, mode: 'insensitive' } },
                { bio: { contains: q, mode: 'insensitive' } },
                { city: { contains: q, mode: 'insensitive' } },
                { country: { contains: q, mode: 'insensitive' } },
                { skills: { has: q } },
              ],
            }
          : {}),
        skills: query.skill ? { has: query.skill } : undefined,
        country: query.country ?? undefined,
        availability: query.availability ?? undefined,
        hourlyRate: {
          gte: query.minRate ?? undefined,
          lte: query.maxRate ?? undefined,
        },
      },
      select: PUBLIC_PROFILE_SELECT,
    });
  }

  async addPortfolioItem(userId: string, dto: CreatePortfolioItemDto) {
    const kind = dto.kind || 'portfolio';
    const subtitle = dto.subtitle ?? null;
    const url = dto.url || dto.projectUrl || null;
    const amount = dto.amount != null ? Number(dto.amount) : null;
    const startYear = dto.startYear ?? dto.start_year ?? null;
    const endYear = dto.endYear ?? dto.end_year ?? null;
    const description = dto.description ?? null;
    const imageUrl = dto.imageUrl ?? null;
    const projectUrl = dto.projectUrl || dto.url || null;

    return this.prisma.portfolioItem.create({
      data: {
        userId,
        kind,
        title: dto.title,
        subtitle,
        url,
        amount,
        startYear,
        endYear,
        description,
        imageUrl,
        projectUrl,
      },
    });
  }

  async removePortfolioItem(userId: string, itemId: string) {
    const item = await this.prisma.portfolioItem.findUnique({
      where: { id: itemId },
    });
    if (!item) throw new NotFoundException('Portfolio item not found');
    if (item.userId !== userId)
      throw new ForbiddenException('Not your portfolio item');
    return this.prisma.portfolioItem.delete({ where: { id: itemId } });
  }
}
