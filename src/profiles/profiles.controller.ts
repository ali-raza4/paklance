import {
  Controller,
  Get,
  Patch,
  Put,
  Param,
  Query,
  Post,
  Delete,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreatePortfolioItemDto } from './dto/create-portfolio-item.dto';
import { SearchProfilesDto } from './dto/search-profiles.dto';

@Controller(['profiles', 'talent'])
export class ProfilesController {
  constructor(
    private readonly profilesService: ProfilesService,
    private readonly jwtService: JwtService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyProfile(@Req() req: Request) {
    const userId = (req as any).user.id;
    return this.profilesService.getProfileByUserId(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMyProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const userId = (req as any).user.id;
    return this.profilesService.updateProfile(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Put('me')
  updateMyProfilePut(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const userId = (req as any).user.id;
    return this.profilesService.updateProfile(userId, dto);
  }

  @Get('search')
  searchProfiles(@Query() query: SearchProfilesDto) {
    return this.profilesService.searchProfiles(query);
  }

  @Get()
  findAll(@Query() query: SearchProfilesDto) {
    return this.profilesService.searchProfiles(query);
  }

  @Get(':userId')
  async getProfile(@Param('userId') userId: string, @Req() req: Request) {
    let requestingUser: any = (req as any).user;
    if (!requestingUser && req.headers && req.headers.authorization) {
      const auth = req.headers.authorization;
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        const token = auth.substring(7);
        try {
          const decoded: any = this.jwtService.verify(token);
          if (decoded) {
            requestingUser = {
              id: decoded.sub || decoded.id,
              role: decoded.role,
            };
          }
        } catch (e) {
          try {
            const decoded: any = this.jwtService.decode(token);
            if (decoded) {
              requestingUser = {
                id: decoded.sub || decoded.id,
                role: decoded.role,
              };
            }
          } catch (e2) {}
        }
      }
    }
    const profile = await this.profilesService.getProfileByUserId(
      userId,
      requestingUser,
    );
    return {
      talent: profile,
      profile: profile,
      ...profile,
      page: {
        photo: profile.avatarUrl || null,
        video: profile.video || null,
        items: profile.portfolioItems || [],
        rating: null,
        reviews: [],
        seller: {},
        buyer: {},
      },
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/portfolio')
  addPortfolioItem(@Req() req: Request, @Body() dto: CreatePortfolioItemDto) {
    const userId = (req as any).user.id;
    return this.profilesService.addPortfolioItem(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/items')
  addProfileItem(@Req() req: Request, @Body() dto: CreatePortfolioItemDto) {
    const userId = (req as any).user.id;
    return this.profilesService.addPortfolioItem(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/portfolio/:id')
  deletePortfolioItem(@Req() req: Request, @Param('id') id: string) {
    const userId = (req as any).user.id;
    return this.profilesService.removePortfolioItem(userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/items/:id')
  deleteProfileItem(@Req() req: Request, @Param('id') id: string) {
    const userId = (req as any).user.id;
    return this.profilesService.removePortfolioItem(userId, id);
  }
}
