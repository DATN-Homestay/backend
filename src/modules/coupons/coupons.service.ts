import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Coupon,
  CouponCreatorRole,
  CouponSponsor,
} from './entities/coupon.entity.js';
import { CreateHostCouponDto } from './dto/create-host-coupon.dto.js';

@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(
    @InjectRepository(Coupon)
    private readonly couponRepo: Repository<Coupon>,
  ) {}

  async getHostCoupons(hostId: string) {
    return await this.couponRepo.find({
      where: { host_id: hostId },
      order: { created_at: 'DESC' },
    });
  }

  async createHostCoupon(hostId: string, dto: CreateHostCouponDto) {
    const code = dto.code.trim().toUpperCase();

    const existing = await this.couponRepo.findOne({
      where: { code },
    });
    if (existing) {
      throw new ConflictException(`Mã voucher '${code}' đã tồn tại trên hệ thống.`);
    }

    const startDate = new Date(dto.start_date);
    const endDate = new Date(dto.end_date);
    if (startDate >= endDate) {
      throw new BadRequestException('start_date phải nhỏ hơn end_date');
    }

    const coupon = this.couponRepo.create({
      code,
      created_by_role: CouponCreatorRole.HOST,
      host_id: hostId,
      sponsor_by: CouponSponsor.HOST,
      discount_type: dto.discount_type,
      discount_value: dto.discount_value,
      min_order_value: dto.min_order_value ?? 0,
      start_date: startDate,
      end_date: endDate,
    });

    const saved = await this.couponRepo.save(coupon);
    this.logger.log(`Host #${hostId} đã tạo mã voucher mới: ${code}`);
    return saved;
  }

  async deleteHostCoupon(hostId: string, couponId: string) {
    const coupon = await this.couponRepo.findOne({
      where: { id: couponId },
    });
    if (!coupon) {
      throw new NotFoundException(`Không tìm thấy mã voucher #${couponId}`);
    }
    if (coupon.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu mã voucher này');
    }

    await this.couponRepo.remove(coupon);
    return { message: `Đã xóa mã voucher #${couponId}` };
  }
}
