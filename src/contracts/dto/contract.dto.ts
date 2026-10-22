import {
  IsNotEmpty,
  IsString,
  IsArray,
  ValidateNested,
  IsNumber,
  IsPositive,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMilestoneDto {
  @ApiProperty({ example: 'Phase 1: Backend Setup' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Initial setup of NestJS, Prisma & Auth' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 250.0 })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount: number;
}

export class CreateContractDto {
  @ApiProperty({ example: 'job-uuid-here' })
  @IsString()
  @IsNotEmpty()
  jobId: string;

  @ApiProperty({ example: 'specialist-user-uuid-here' })
  @IsString()
  @IsNotEmpty()
  specialistId: string;

  @ApiProperty({ type: [CreateMilestoneDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMilestoneDto)
  milestones: CreateMilestoneDto[];
}

export class UploadContractFileDto {
  @ApiProperty({ example: 'specification.pdf' })
  @IsString()
  @IsNotEmpty()
  filename: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 1048576 })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  size: number;

  @ApiProperty({ example: 'data:application/pdf;base64,...' })
  @IsString()
  @IsNotEmpty()
  fileData: string;
}

export class SubmitMilestoneDto {
  @ApiPropertyOptional({ example: 'Completed initial delivery according to agreed scope.' })
  @IsOptional()
  @IsString()
  deliverableNote?: string;

  @ApiPropertyOptional({ example: ['https://example.com/demo', 'https://github.com/...'] })
  @IsOptional()
  @IsArray()
  deliverableUrls?: string[];
}

export class RequestRevisionDto {
  @ApiProperty({ example: 'Please adjust typography and add the missing export button.' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
