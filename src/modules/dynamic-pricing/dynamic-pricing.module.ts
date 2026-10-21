import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiPricingLog } from './entities/index.js';
import { Homestay } from '../homestays/entities/homestay.entity.js';
import { Room } from '../homestays/entities/room.entity.js';
import { PriceCalendar } from '../homestays/entities/price-calendar.entity.js';
import { DynamicPricingService } from './dynamic-pricing.service.js';
import { DynamicPricingController } from './dynamic-pricing.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiPricingLog,
      Homestay,
      Room,
      PriceCalendar,
    ]),
  ],
  controllers: [DynamicPricingController],
  providers: [DynamicPricingService],
  exports: [DynamicPricingService, TypeOrmModule],
})
export class DynamicPricingModule {}
