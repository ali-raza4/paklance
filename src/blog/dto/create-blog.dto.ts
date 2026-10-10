import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BlogStatus } from '@prisma/client';

export class CreateBlogDto {
  @ApiProperty({ description: 'Blog title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ description: 'Unique URL slug (auto-generated if omitted)' })
  @IsString()
  @IsOptional()
  slug?: string;

  @ApiPropertyOptional({ description: 'Short summary or excerpt' })
  @IsString()
  @IsOptional()
  excerpt?: string;

  @ApiProperty({ description: 'Main rich-text / HTML content' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: 'Featured image or cover image URL' })
  @IsString()
  @IsOptional()
  coverImageUrl?: string;

  @ApiPropertyOptional({ description: 'Category', default: 'Freelancing' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'List of tags', type: [String] })
  @IsArray()
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({ description: 'Author name', default: 'Paklance Editorial Team' })
  @IsString()
  @IsOptional()
  authorName?: string;

  @ApiPropertyOptional({ description: 'Publication status', enum: BlogStatus, default: BlogStatus.DRAFT })
  @IsEnum(BlogStatus)
  @IsOptional()
  status?: BlogStatus;

  @ApiPropertyOptional({ description: 'SEO Meta Title' })
  @IsString()
  @IsOptional()
  metaTitle?: string;

  @ApiPropertyOptional({ description: 'SEO Meta Description' })
  @IsString()
  @IsOptional()
  metaDescription?: string;
}
