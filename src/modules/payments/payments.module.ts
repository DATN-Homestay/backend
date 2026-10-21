import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  PaymentTransaction,
  PayoutRequest,
} from './entities/index.js';
import { Booking } from '../bookings/entities/booking.entity.js';
import { EscrowHold } from '../bookings/entities/escrow-hold.entity.js';
import { RefundTransaction } from '../bookings/entities/refund-transaction.entity.js';
import { PaymentsService } from './payments.service.js';
import { HostPayoutsController } from './host-payouts.controller.js';
import { CustomerPaymentsController } from './customer-payments.controller.js';
import { CustomerPaymentsService } from './customer-payments.service.js';
import { PriceCalendar } from '../homestays/entities/price-calendar.entity.js';
import { BookingsModule } from '../bookings/bookings.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentTransaction,
      PayoutRequest,
      Booking,
      EscrowHold,
      PriceCalendar,
      RefundTransaction,
    ]),
    BookingsModule,
  ],
  controllers: [HostPayoutsController, CustomerPaymentsController],
  providers: [PaymentsService, CustomerPaymentsService],
  exports: [PaymentsService, CustomerPaymentsService, TypeOrmModule],
})
export class PaymentsModule {}
