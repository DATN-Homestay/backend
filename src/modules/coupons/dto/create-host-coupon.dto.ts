import { IsNotEmpty, IsString, IsNumber, IsOptional, IsEnum } from 'class-validator';
import { DiscountType } from '../entities/coupon.entity.js';

export class CreateHostCouponDto {
  @IsString()
  @IsNotEmpty({ message: 'Mã coupon không được để trống' })
  code: string;

  @IsEnum(DiscountType, { message: 'discount_type phải là PERCENT hoặc FIXED_AMOUNT' })
  discount_type: DiscountType;

  @IsNumber()
  @IsNotEmpty({ message: 'Giá trị giảm không được để trống' })
  discount_value: number;

  @IsOptional()
  @IsNumber()
  min_order_value?: number;

  @IsString()
  @IsNotEmpty({ message: 'Ngày bắt đầu không được để trống' })
  start_date: string;

  @IsString()
  @IsNotEmpty({ message: 'Ngày kết thúc không được để trống' })
  end_date: string;
}
