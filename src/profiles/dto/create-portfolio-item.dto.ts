import { IsString, IsOptional, IsNotEmpty, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePortfolioItemDto {
  @IsOptional() @IsString() kind?: string;
  @IsString() @IsNotEmpty() title: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() url?: string;
  @IsOptional() @Type(() => Number) @IsNumber() amount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() startYear?: number;
  @IsOptional() @Type(() => Number) @IsNumber() endYear?: number;
  @IsOptional() @Type(() => Number) @IsNumber() start_year?: number;
  @IsOptional() @Type(() => Number) @IsNumber() end_year?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() projectUrl?: string;
}
