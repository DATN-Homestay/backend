import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Booking,
  EscrowHold,
  RefundTransaction,
} from './entities/index.js';
import { BookingsService } from './bookings.service.js';
import { HostBookingsController } from './host-bookings.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      EscrowHold,
      RefundTransaction,
    ]),
  ],
  controllers: [HostBookingsController],
  providers: [BookingsService],
  exports: [BookingsService, TypeOrmModule],
})
export class BookingsModule {}
