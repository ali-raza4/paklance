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

/* =========================================================================
   PUBLIC BLOG CONTROLLER (/api/blog/...)
   ========================================================================= */
@ApiTags('Blog Public')
@Controller('blog')
export class BlogPublicController {
  constructor(private readonly blogService: BlogService) {}

  @ApiOperation({ summary: 'Get published blog posts' })
  @Get('articles')
  getPublishedBlogs(
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: number,
    @Query('skip') skip?: number,
  ) {
    return this.blogService.getPublishedBlogs({ category, search, limit, skip });
  }

  @ApiOperation({ summary: 'Get published blog post by slug' })
  @Get('articles/:slug')
  getBlogBySlug(@Param('slug') slug: string) {
    return this.blogService.getBlogBySlug(slug, false);
  }
}

/* =========================================================================
   ADMIN BLOG CONTROLLER (/api/admin/blogs/...)
   ========================================================================= */
@ApiTags('Blog Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/blogs')
export class BlogAdminController {
  constructor(
    private readonly blogService: BlogService,
    private readonly storageService: StorageService,
  ) {}

  @ApiOperation({ summary: 'Get all blogs for Admin' })
  @Get()
  getAllBlogs(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.blogService.getAllBlogsForAdmin({ status, search, category });
  }

  @ApiOperation({ summary: 'Get single blog post by ID' })
  @Get(':id')
  getBlogById(@Param('id') id: string) {
    return this.blogService.getBlogById(id);
  }

  @ApiOperation({ summary: 'Create new blog post' })
  @Post()
  createBlog(@Body() dto: CreateBlogDto) {
    return this.blogService.createBlog(dto);
  }

  @ApiOperation({ summary: 'Update existing blog post' })
  @Patch(':id')
  updateBlog(@Param('id') id: string, @Body() dto: UpdateBlogDto) {
    return this.blogService.updateBlog(id, dto);
  }

  @ApiOperation({ summary: 'Delete blog post' })
  @Delete(':id')
  deleteBlog(@Param('id') id: string) {
    return this.blogService.deleteBlog(id);
  }

  @ApiOperation({ summary: 'Upload blog cover or in-content image' })
  @ApiConsumes('multipart/form-data')
  @Post('upload-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_SIZE } }))
  async uploadBlogImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Image file is required');
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Invalid image format. Supported formats: JPEG, PNG, WebP, GIF, SVG');
    }
    const url = await this.storageService.uploadFile(file);
    return { url };
  }
}
