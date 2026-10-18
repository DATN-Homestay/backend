import { DiscountType } from '../entities/coupon.entity.js';

export class CreateHostCouponDto {
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  min_order_value?: number;
  start_date: string;
  end_date: string;
}
