import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiPricingLog } from './entities/index.js';

@Module({
  imports: [TypeOrmModule.forFeature([AiPricingLog])],
  exports: [TypeOrmModule],
})
export class DynamicPricingModule {}
