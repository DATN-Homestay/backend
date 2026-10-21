import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon } from './entities/index.js';
import { CouponsService } from './coupons.service.js';
import { HostCouponsController } from './host-coupons.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Coupon])],
  controllers: [HostCouponsController],
  providers: [CouponsService],
  exports: [CouponsService, TypeOrmModule],
})
export class CouponsModule {}
