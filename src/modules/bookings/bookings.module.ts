import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Booking,
  EscrowHold,
  RefundTransaction,
} from './entities/index.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      EscrowHold,
      RefundTransaction,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class BookingsModule {}
