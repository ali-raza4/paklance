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
import { PatchMeDto, PutProfileDto, PutVideoDto } from './me.dto';
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

  private parseVideoLink(url: string) {
    let s = String(url || '').trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    if (/\s/.test(s) || s.length > 300) return null;
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i)))
      return { provider: 'YouTube', id: m[1], url: s };
    if ((m = s.match(/^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})(?!\d)/i)))
      return { provider: 'Vimeo', id: m[1], url: s };
    if ((m = s.match(/^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([a-f0-9]{16,40})(?![a-f0-9])/i)))
      return { provider: 'Loom', id: m[1], url: s };
    if ((m = s.match(/^https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]{20,})/i)))
      return { provider: 'Google Drive', id: m[1], url: s };
    return null;
  }

  private formatVideoResponse(user: any) {
    if (!user || !user.videoUrl) return null;
    if (user.videoKind === 'upload') {
      return {
        kind: 'upload',
        url: user.videoUrl,
        name: user.videoName || 'Video',
        size: user.videoSize != null ? Number(user.videoSize) : null,
        type: user.videoType || '',
        duration: user.videoDuration != null ? Number(user.videoDuration) : null,
      };
    }
    return { kind: 'link', url: user.videoUrl };
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

    const rate = dto.hourlyRate ?? dto.hourly_rate ?? dto.rate;
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
        name: user.name || null,
        fullName: user.name || null,
        avatarUrl: user.avatarUrl || null,
        photo: user.avatarUrl || null,
      },
      items: formattedItems,
      portfolioItems: formattedItems,
      video: this.formatVideoResponse(user),
    };
  }

  @ApiOperation({ summary: 'Update current user extended profile' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put('profile')
  async putMyProfile(@Req() req: Request, @Body() dto: PutProfileDto) {
    const userId = (req as any).user.id;
    const data: any = {};

    const name = dto.fullName ?? dto.name;
    if (name !== undefined) data.name = name.trim();

    if (dto.headline !== undefined) data.headline = dto.headline;
    const bio = dto.bio ?? dto.about;
    if (bio !== undefined) data.bio = bio;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.country !== undefined) data.country = dto.country;

    if (dto.skills !== undefined) {
      data.skills = Array.isArray(dto.skills) ? dto.skills : [];
    }

    const rate = dto.hourlyRate ?? dto.hourly_rate ?? dto.rate;
    if (rate !== undefined && !isNaN(Number(rate))) {
      data.hourlyRate = Number(rate);
    }

    const avatar = dto.avatarUrl ?? dto.photo;
    if (avatar !== undefined) data.avatarUrl = avatar;

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
        name: updated.name || null,
        fullName: updated.name || null,
        avatarUrl: updated.avatarUrl || null,
        photo: updated.avatarUrl || null,
      },
      video: this.formatVideoResponse(updated),
      user: {
        id: updated.id,
        email: updated.email,
        role: updated.role,
        name: updated.name,
        fullName: updated.name,
        skills: updated.skills || [],
        headline: updated.headline || null,
        bio: updated.bio || null,
        city: updated.city || null,
        country: updated.country || null,
        hourlyRate: numRate,
        hourly_rate: numRate,
        avatarUrl: updated.avatarUrl || null,
        photo: updated.avatarUrl || null,
        availability: updated.availability,
        isEmailVerified: updated.isEmailVerified,
      },
    };
  }

  @ApiOperation({ summary: 'Generate client upload token for direct Blob storage upload' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('profile/video/upload-token')
  async getUploadToken(
    @Req() req: Request,
    @Body() body: any,
  ) {
    const userId = (req as any).user.id;
    const duration = Math.round(Number(body && body.duration));
    const minSec = 10;
    const maxSec = parseInt(process.env.VIDEO_MAX_SECONDS || '15', 10);
    if (Number.isFinite(duration) && duration > maxSec) {
      throw new BadRequestException(`Keep your video between ${minSec} and ${maxSec} seconds.`);
    }
    if (Number.isFinite(duration) && duration > 0 && duration < minSec) {
      throw new BadRequestException(`Record at least ${minSec} seconds.`);
    }

    const rawName = String(body && (body.pathname || body.filename || body.name || 'video.mp4'));
    const ext = (rawName.match(/\.[a-z0-9]+$/i) || ['.mp4'])[0].toLowerCase();
    if (!['.mp4', '.mov', '.webm', '.m4v'].includes(ext)) {
      throw new BadRequestException('Choose an MP4, MOV or WebM video.');
    }

    return this.storageService.createUploadToken(userId, rawName);
  }

  @ApiOperation({ summary: 'Save or remove video introduction' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put('profile/video')
  async saveVideo(@Req() req: Request, @Body() dto: PutVideoDto) {
    const userId = (req as any).user.id;
    const raw = dto && dto.url;
    if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
      const existing = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { videoUrl: true },
      });
      if (existing?.videoUrl) {
        await this.storageService.deleteFile(existing.videoUrl);
      }

      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: {
          videoKind: null,
          videoUrl: null,
          videoName: null,
          videoSize: null,
          videoType: null,
          videoDuration: null,
        },
      });
      return { video: null };
    }

    if (typeof raw !== 'string') {
      throw new BadRequestException('Paste a link to your video.');
    }

    // Check if saving an uploaded video (e.g. from direct Blob upload or data URI)
    const isUploaded = (dto && dto.kind === 'upload') ||
      raw.includes('.blob.vercel-storage.com') ||
      raw.startsWith('data:video/') ||
      raw.includes('/videos/') ||
      raw.includes('/uploads/');

    if (isUploaded) {
      const duration = Math.round(Number(dto && dto.duration));
      const minSec = 10;
      const maxSec = parseInt(process.env.VIDEO_MAX_SECONDS || '15', 10);
      if (Number.isFinite(duration) && duration > maxSec) {
        throw new BadRequestException(`Keep your video between ${minSec} and ${maxSec} seconds.`);
      }
      if (Number.isFinite(duration) && duration > 0 && duration < minSec) {
        throw new BadRequestException(`Record at least ${minSec} seconds.`);
      }

      const cleanName = String((dto && dto.name) || 'Video').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 200) || 'Video';
      const size = dto && dto.size ? BigInt(dto.size) : null;
      const type = String((dto && dto.type) || 'video/mp4');

      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: {
          videoKind: 'upload',
          videoUrl: raw,
          videoName: cleanName,
          videoSize: size,
          videoType: type,
          videoDuration: Number.isFinite(duration) && duration > 0 ? duration : null,
        },
      });
      return { video: this.formatVideoResponse(updated) };
    }

    // Otherwise validate as an external link (YouTube, Vimeo, Loom, Google Drive)
    const parsed = this.parseVideoLink(raw);
    if (!parsed) {
      throw new BadRequestException('Use a YouTube, Vimeo, Loom or Google Drive link to your video.');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        videoKind: 'link',
        videoUrl: parsed.url,
        videoName: null,
        videoSize: null,
        videoType: null,
        videoDuration: null,
      },
    });
    return { video: this.formatVideoResponse(updated) };
  }

  @ApiOperation({ summary: 'Delete video introduction' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('profile/video')
  async deleteVideo(@Req() req: Request) {
    return this.saveVideo(req, { url: null });
  }

  @ApiOperation({ summary: 'Upload video introduction file' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('profile/video/upload')
  @UseInterceptors(
    FileInterceptor('video', {
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  async uploadVideo(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
  ) {
    const userId = (req as any).user.id;
    if (!file) throw new BadRequestException('Video file is required');

    const validMimes = /^video\/(mp4|quicktime|webm|x-m4v)$/i;
    const validExts = /\.(mp4|mov|webm|m4v)$/i;
    if (!validMimes.test(file.mimetype || '') && !validExts.test(file.originalname || '')) {
      throw new BadRequestException('Choose an MP4, MOV or WebM video.');
    }

    const duration = Math.round(Number(body && body.duration));
    const minSec = 10;
    const maxSec = parseInt(process.env.VIDEO_MAX_SECONDS || '15', 10);
    if (Number.isFinite(duration) && duration > maxSec) {
      throw new BadRequestException(`Keep your video between ${minSec} and ${maxSec} seconds.`);
    }
    if (Number.isFinite(duration) && duration > 0 && duration < minSec) {
      throw new BadRequestException(`Record at least ${minSec} seconds.`);
    }

    // Delete existing video if present
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { videoUrl: true },
    });
    if (existing?.videoUrl) {
      await this.storageService.deleteFile(existing.videoUrl);
    }

    const url = await this.storageService.uploadFile(file);
    const cleanName = String(file.originalname || 'Video').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 200) || 'Video';

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        videoKind: 'upload',
        videoUrl: url,
        videoName: cleanName,
        videoSize: BigInt(file.size),
        videoType: file.mimetype || 'video/mp4',
        videoDuration: Number.isFinite(duration) && duration > 0 ? duration : null,
      },
    });

    return { video: this.formatVideoResponse(updated) };
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
