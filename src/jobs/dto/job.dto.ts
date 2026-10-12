import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
  Min,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateJobDto {
  @ApiProperty({ example: 'Full Stack NestJS Developer' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    example: 'Looking for a NestJS expert for freelance marketplace project.',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({ example: 500.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  budget?: number;

  @ApiPropertyOptional({ example: ['React', 'NestJS'] })
  @IsOptional()
  skills?: any;

  @ApiPropertyOptional({ example: 'Web & Software Development' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'FREELANCE' })
  @IsOptional()
  @IsString()
  jobType?: string;

  @ApiPropertyOptional({ example: 'FIXED' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  hourlyMin?: number;

  @ApiPropertyOptional({ example: 2000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  hourlyMax?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weeklyHours?: number;

  @ApiPropertyOptional({ example: 25000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weeklyRate?: number;

  @ApiPropertyOptional({ example: 90000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyRate?: number;

  @ApiPropertyOptional({ example: 'PKR' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  deliveryDays?: number;

  @ApiPropertyOptional({ example: '2-4 weeks' })
  @IsOptional()
  @IsString()
  duration?: string;

  @ApiPropertyOptional({ example: 'INTERMEDIATE' })
  @IsOptional()
  @IsString()
  experienceLevel?: string;

  @ApiPropertyOptional({ example: 'REMOTE' })
  @IsOptional()
  @IsString()
  locationType?: string;

  @ApiPropertyOptional({ example: 'Lahore, Pakistan' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  safepay?: boolean;
}

export class QueryJobDto {
  @ApiPropertyOptional({ example: 'NestJS' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'FREELANCE' })
  @IsOptional()
  @IsString()
  jobType?: string;

  @ApiPropertyOptional({ example: 'FIXED' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({ example: 'Web & Software Development' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'React' })
  @IsOptional()
  @IsString()
  skills?: string;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  minBudget?: number;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  maxBudget?: number;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  minHourly?: number;

  @ApiPropertyOptional({ example: 3000 })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  maxHourly?: number;

  @ApiPropertyOptional({ example: 'INTERMEDIATE' })
  @IsOptional()
  @IsString()
  experienceLevel?: string;

  @ApiPropertyOptional({ example: 'REMOTE' })
  @IsOptional()
  @IsString()
  locationType?: string;

  @ApiPropertyOptional({ example: 'uuid-of-client' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  safepay?: any;
}

export class UpdateJobDto {
  @ApiPropertyOptional({ example: 'Senior Full Stack NestJS Developer' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({
    example: 'Updated description for the NestJS freelance role.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @ApiPropertyOptional({ example: 750.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  budget?: number;

  @ApiPropertyOptional({ example: ['React', 'NestJS'] })
  @IsOptional()
  skills?: any;

  @ApiPropertyOptional({ example: 'Web & Software Development' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'CONTRACT' })
  @IsOptional()
  @IsString()
  jobType?: string;

  @ApiPropertyOptional({ example: 'HOURLY' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({ example: 1200 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  hourlyMin?: number;

  @ApiPropertyOptional({ example: 2500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  hourlyMax?: number;

  @ApiPropertyOptional({ example: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weeklyHours?: number;

  @ApiPropertyOptional({ example: 30000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weeklyRate?: number;

  @ApiPropertyOptional({ example: 120000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  monthlyRate?: number;

  @ApiPropertyOptional({ example: 'PKR' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  deliveryDays?: number;

  @ApiPropertyOptional({ example: '1-3 months' })
  @IsOptional()
  @IsString()
  duration?: string;

  @ApiPropertyOptional({ example: 'EXPERT' })
  @IsOptional()
  @IsString()
  experienceLevel?: string;

  @ApiPropertyOptional({ example: 'REMOTE' })
  @IsOptional()
  @IsString()
  locationType?: string;

  @ApiPropertyOptional({ example: 'Karachi, Pakistan' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  safepay?: boolean;

  @ApiPropertyOptional({ example: 'OPEN' })
  @IsOptional()
  @IsString()
  status?: string;
}
