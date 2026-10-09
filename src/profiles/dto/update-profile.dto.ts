import {
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProfileDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() bio?: string;
  @IsOptional() @IsString() about?: string;
  @IsOptional() @IsString() headline?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) skills?: string[];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) hourlyRate?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) hourly_rate?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) rate?: number;
  @IsOptional() availability?: any;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() avatarUrl?: string;
  @IsOptional() @IsString() photo?: string;
  @IsOptional() @IsString() category?: string;
}
