import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { QuoteBookingDto } from './quote-booking.dto.js';

export class CreateBookingDto extends QuoteBookingDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Ghi chú tối đa 500 ký tự' })
  customer_note?: string;
}
