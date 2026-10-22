import { IsNumber, Min, IsOptional, IsEnum, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';

export class DepositDto {
  @ApiProperty({ example: 10000, description: 'PKR amount to deposit into wallet' })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ enum: PaymentProvider, default: PaymentProvider.BANK_TRANSFER })
  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;

  @ApiPropertyOptional({ description: 'Optional deposit description / note' })
  @IsOptional()
  @IsString()
  description?: string;
}
