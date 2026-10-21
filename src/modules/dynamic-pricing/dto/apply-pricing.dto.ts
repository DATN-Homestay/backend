import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

export class ApplyPricingDto {
  @IsString()
  @IsNotEmpty()
  homestay_id: string;

  @IsString()
  @IsNotEmpty()
  date: string;

  @IsOptional()
  @IsNumber()
  applied_price?: number;

  @IsOptional()
  @IsNumber()
  new_price?: number;

  @IsOptional()
  @IsString()
  room_id?: string;
}
