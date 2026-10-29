import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class CancelBookingDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(5, 500, { message: 'Lý do hủy phải từ 5 đến 500 ký tự' })
  reason: string;

  /** Số tiền hoàn khách đã thấy ở bước xem trước; khác kết quả tính lại thì server trả 409 để xác nhận lại */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expected_refund_amount?: number;
}
