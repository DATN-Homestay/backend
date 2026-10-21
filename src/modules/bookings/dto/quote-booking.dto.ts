import { Type } from 'class-transformer';
import { IsInt, IsNumberString, IsOptional, Matches, Max, Min } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Báo giá & đặt phòng. Tuyệt đối không có trường giá: server tự tính từ price_calendars (BR-009). */
export class QuoteBookingDto {
  @IsNumberString({ no_symbols: true }, { message: 'room_id không hợp lệ' })
  room_id: string;

  @Matches(DATE_PATTERN, { message: 'check_in_date phải có dạng YYYY-MM-DD' })
  check_in_date: string;

  @Matches(DATE_PATTERN, { message: 'check_out_date phải có dạng YYYY-MM-DD' })
  check_out_date: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số khách phải là số nguyên' })
  @Min(1, { message: 'Số khách tối thiểu là 1' })
  @Max(50)
  num_guests?: number;
}
