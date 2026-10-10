import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { BlogService } from './blog.service';
import { CreateBlogDto } from './dto/create-blog.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { StorageService } from '../storage/storage.service';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

@ApiTags('Blog & Content Management')
@Controller()
export class BlogController {
  constructor(
    private readonly blogService: BlogService,
    private readonly storageService: StorageService,
  ) {}

  /* =========================================================================
     PUBLIC ENDPOINTS (For Public Website)
     ========================================================================= */

  @ApiOperation({ summary: 'Get published blog posts with optional filters' })
  @Get(['blog/articles', 'blog'])
  getPublishedBlogs(
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: number,
    @Query('skip') skip?: number,
  ) {
    return this.blogService.getPublishedBlogs({ category, search, limit, skip });
  }

  @ApiOperation({ summary: 'Get published blog post by URL slug' })
  @Get(['blog/articles/:slug', 'blog/:slug'])
  getBlogBySlug(@Param('slug') slug: string) {
    return this.blogService.getBlogBySlug(slug, false);
  }

  /* =========================================================================
     ADMIN ENDPOINTS (Protected: Admin Only)
     ========================================================================= */

  @ApiOperation({ summary: 'Get all blogs (Drafts, Published, Archived) for Admin' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('admin/blogs')
  getAllBlogsForAdmin(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.blogService.getAllBlogsForAdmin({ status, search, category });
  }

  @ApiOperation({ summary: 'Get single blog post by ID (Admin preview/edit)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('admin/blogs/:id')
  getAdminBlogById(@Param('id') id: string) {
    return this.blogService.getBlogById(id);
  }

  @ApiOperation({ summary: 'Create new blog post (Admin only)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('admin/blogs')
  createBlog(@Body() dto: CreateBlogDto) {
    return this.blogService.createBlog(dto);
  }

  @ApiOperation({ summary: 'Update existing blog post (Admin only)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch('admin/blogs/:id')
  updateBlog(@Param('id') id: string, @Body() dto: UpdateBlogDto) {
    return this.blogService.updateBlog(id, dto);
  }

  @ApiOperation({ summary: 'Delete blog post (Admin only)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete('admin/blogs/:id')
  deleteBlog(@Param('id') id: string) {
    return this.blogService.deleteBlog(id);
  }

  @ApiOperation({ summary: 'Upload blog cover or in-content image' })
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('admin/blogs/upload-image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_SIZE },
    }),
  )
  async uploadBlogImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid image format. Supported formats: JPEG, PNG, WebP, GIF, SVG',
      );
    }

    const url = await this.storageService.uploadFile(file);
    return { url };
  }
}
