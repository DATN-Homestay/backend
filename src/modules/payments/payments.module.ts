import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  PaymentTransaction,
  PayoutRequest,
} from './entities/index.js';
import { Booking } from '../bookings/entities/booking.entity.js';
import { EscrowHold } from '../bookings/entities/escrow-hold.entity.js';
import { PaymentsService } from './payments.service.js';
import { HostPayoutsController } from './host-payouts.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentTransaction,
      PayoutRequest,
      Booking,
      EscrowHold,
    ]),
  ],
  controllers: [HostPayoutsController],
  providers: [PaymentsService],
  exports: [PaymentsService, TypeOrmModule],
})
export class PaymentsModule {}
