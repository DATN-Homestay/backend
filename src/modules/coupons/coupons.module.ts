import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon } from './entities/index.js';

@Module({
  imports: [TypeOrmModule.forFeature([Coupon])],
  exports: [TypeOrmModule],
})
export class CouponsModule {}
