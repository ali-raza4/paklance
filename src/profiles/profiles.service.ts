import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreatePortfolioItemDto } from './dto/create-portfolio-item.dto';
import { SearchProfilesDto } from './dto/search-profiles.dto';

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
    return this.prisma.user.update({
      where: { id: userId },
      data: { ...dto },
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
    return this.prisma.portfolioItem.create({ data: { ...dto, userId } });
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
