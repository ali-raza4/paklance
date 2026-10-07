import {
  Controller,
  Get,
  Patch,
  Put,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ProfilesService } from '../profiles/profiles.service';
import { PatchMeDto, PutProfileDto } from './me.dto';
import { CreatePortfolioItemDto } from '../profiles/dto/create-portfolio-item.dto';
import { Availability } from '@prisma/client';

@ApiTags('Current User Profile')
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly storageService: StorageService,
    private readonly profilesService: ProfilesService,
  ) {}

  private mapAvailability(val?: string): Availability | undefined {
    if (!val) return undefined;
    const v = val.toUpperCase().trim();
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

  private formatUserResponse(user: any) {
    const rate = user.hourlyRate != null ? Number(user.hourlyRate) : null;
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        fullName: user.name,
        skills: user.skills || [],
        headline: user.headline || null,
        bio: user.bio || null,
        city: user.city || null,
        country: user.country || null,
        hourlyRate: rate,
        hourly_rate: rate,
        avatarUrl: user.avatarUrl || null,
        photo: user.avatarUrl || null,
        availability: user.availability,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  @ApiOperation({ summary: 'Get current user profile and skills' })
  @Get()
  async getMe(@Req() req: Request) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { user: null };
    }
    const token = authHeader.slice(7).trim();
    try {
      const payload: any = this.jwtService.verify(token);
      if (!payload || !payload.sub) {
        return { user: null };
      }
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user) return { user: null };
      return this.formatUserResponse(user);
    } catch {
      return { user: null };
    }
  }

  @ApiOperation({ summary: 'Update current user profile and skills' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch()
  async patchMe(@Req() req: Request, @Body() dto: PatchMeDto) {
    const userId = (req as any).user.id;
    const data: any = {};

    if (dto.skills !== undefined) {
      data.skills = Array.isArray(dto.skills) ? dto.skills : [];
    }

    const name = dto.fullName ?? dto.name;
    if (name !== undefined) {
      data.name = name.trim();
    }

    const bio = dto.bio ?? dto.about;
    if (bio !== undefined) {
      data.bio = bio;
    }

    if (dto.headline !== undefined) {
      data.headline = dto.headline;
    }

    if (dto.city !== undefined) {
      data.city = dto.city;
    }

    if (dto.country !== undefined) {
      data.country = dto.country;
    }

    const rate = dto.hourlyRate ?? dto.hourly_rate;
    if (rate !== undefined && !isNaN(Number(rate))) {
      data.hourlyRate = Number(rate);
    }

    const avatar = dto.avatarUrl ?? dto.photo;
    if (avatar !== undefined) {
      data.avatarUrl = avatar;
    }

    if (dto.availability !== undefined) {
      data.availability = this.mapAvailability(dto.availability);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    return this.formatUserResponse(updated);
  }

  @ApiOperation({ summary: 'Get current user extended profile' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getMyProfile(@Req() req: Request) {
    const userId = (req as any).user.id;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { portfolioItems: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const rate = user.hourlyRate != null ? Number(user.hourlyRate) : null;
    const formattedItems = (user.portfolioItems || []).map((item) => ({
      id: item.id,
      kind: item.kind || 'portfolio',
      title: item.title,
      subtitle: item.subtitle || null,
      url: item.url || item.projectUrl || null,
      amount: item.amount != null ? Number(item.amount) : null,
      startYear: item.startYear ?? null,
      endYear: item.endYear ?? null,
      description: item.description || null,
      imageUrl: item.imageUrl || null,
      projectUrl: item.projectUrl || item.url || null,
    }));

    return {
      profile: {
        headline: user.headline || null,
        bio: user.bio || null,
        hourlyRate: rate,
        hourly_rate: rate,
        availability: user.availability || null,
        city: user.city || null,
        country: user.country || null,
        skills: user.skills || [],
      },
      items: formattedItems,
      portfolioItems: formattedItems,
      video: null,
    };
  }

  @ApiOperation({ summary: 'Update current user extended profile' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put('profile')
  async putMyProfile(@Req() req: Request, @Body() dto: PutProfileDto) {
    const userId = (req as any).user.id;
    const data: any = {};

    if (dto.headline !== undefined) data.headline = dto.headline;
    const bio = dto.bio ?? dto.about;
    if (bio !== undefined) data.bio = bio;
    if (dto.city !== undefined) data.city = dto.city;

    const rate = dto.hourlyRate ?? dto.hourly_rate;
    if (rate !== undefined && !isNaN(Number(rate))) {
      data.hourlyRate = Number(rate);
    }

    if (dto.availability !== undefined) {
      data.availability = this.mapAvailability(dto.availability);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    const numRate = updated.hourlyRate != null ? Number(updated.hourlyRate) : null;
    return {
      profile: {
        headline: updated.headline || null,
        bio: updated.bio || null,
        hourlyRate: numRate,
        hourly_rate: numRate,
        availability: updated.availability || null,
        city: updated.city || null,
        country: updated.country || null,
        skills: updated.skills || [],
      },
    };
  }

  @ApiOperation({ summary: 'Upload profile photo' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('photo')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadPhoto(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const userId = (req as any).user.id;
    if (!file) throw new BadRequestException('Photo file is required');
    const url = await this.storageService.uploadFile(file);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: url },
    });
    return this.formatUserResponse(updated);
  }

  @ApiOperation({ summary: 'Remove profile photo' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('photo')
  async removePhoto(@Req() req: Request) {
    const userId = (req as any).user.id;
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
    });
    return this.formatUserResponse(updated);
  }

  @ApiOperation({ summary: 'Add portfolio item' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('profile/items')
  async addPortfolioItem(
    @Req() req: Request,
    @Body() dto: CreatePortfolioItemDto,
  ) {
    const userId = (req as any).user.id;
    const item = await this.profilesService.addPortfolioItem(userId, dto);
    const formatted = {
      id: item.id,
      kind: item.kind || 'portfolio',
      title: item.title,
      subtitle: item.subtitle || null,
      url: item.url || item.projectUrl || null,
      amount: item.amount != null ? Number(item.amount) : null,
      startYear: item.startYear ?? null,
      endYear: item.endYear ?? null,
      description: item.description || null,
      imageUrl: item.imageUrl || null,
      projectUrl: item.projectUrl || item.url || null,
    };
    return { item: formatted, portfolioItem: formatted, ...formatted };
  }

  @ApiOperation({ summary: 'Delete portfolio item' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('profile/items/:id')
  async removePortfolioItem(@Req() req: Request, @Param('id') id: string) {
    const userId = (req as any).user.id;
    await this.profilesService.removePortfolioItem(userId, id);
    return { ok: true };
  }
}
