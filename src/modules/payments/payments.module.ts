import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  PaymentTransaction,
  PayoutRequest,
} from './entities/index.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentTransaction,
      PayoutRequest,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class PaymentsModule {}
