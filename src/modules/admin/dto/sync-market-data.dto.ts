import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SyncMarketDataDto {
  @IsString()
  @IsNotEmpty({ message: 'city không được để trống' })
  city: string;

  @IsOptional()
  @IsInt({ message: 'forecast_days phải là số nguyên' })
  @Min(1, { message: 'forecast_days tối thiểu là 1' })
  @Max(30, { message: 'forecast_days tối đa là 30' })
  @Type(() => Number)
  forecast_days?: number;
}
