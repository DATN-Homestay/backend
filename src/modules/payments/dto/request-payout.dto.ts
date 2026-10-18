import { IsOptional, IsString } from 'class-validator';

export class RequestPayoutDto {
  @IsOptional()
  @IsString()
  booking_id?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
