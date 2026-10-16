import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Review, ReviewAbsaMetric } from './entities/index.js';

@Module({
  imports: [TypeOrmModule.forFeature([Review, ReviewAbsaMetric])],
  exports: [TypeOrmModule],
})
export class ReviewsModule {}
