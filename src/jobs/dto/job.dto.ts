import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
  Min,
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

  @ApiProperty({ example: 500.0 })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  budget: number;

  @ApiPropertyOptional({ example: ['React', 'NestJS'] })
  @IsOptional()
  skills?: any;

  @ApiPropertyOptional({ example: 'Web Development' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  deliveryDays?: number;
}

export class QueryJobDto {
  @ApiPropertyOptional({ example: 'NestJS' })
  @IsOptional()
  @IsString()
  search?: string;

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

  @ApiPropertyOptional({ example: 'uuid-of-client' })
  @IsOptional()
  @IsString()
  clientId?: string;
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
  @IsPositive()
  budget?: number;
}
