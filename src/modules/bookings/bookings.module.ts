import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Booking,
  EscrowHold,
  RefundTransaction,
} from './entities/index.js';
import { Room } from '../homestays/entities/room.entity.js';
import { Homestay } from '../homestays/entities/homestay.entity.js';
import { PriceCalendar } from '../homestays/entities/price-calendar.entity.js';
import { BookingsService } from './bookings.service.js';
import { HostBookingsController } from './host-bookings.controller.js';
import { CustomerBookingsController } from './customer-bookings.controller.js';
import { CustomerBookingsService } from './customer-bookings.service.js';
import { BookingExpiryService } from './booking-expiry.service.js';
import { B2bDemandFulfillmentService } from './b2b-demand-fulfillment.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      EscrowHold,
      RefundTransaction,
      Room,
      Homestay,
      PriceCalendar,
    ]),
  ],
  controllers: [HostBookingsController, CustomerBookingsController],
  providers: [
    BookingsService,
    CustomerBookingsService,
    BookingExpiryService,
    B2bDemandFulfillmentService,
  ],
  exports: [
    BookingsService,
    CustomerBookingsService,
    BookingExpiryService,
    B2bDemandFulfillmentService,
    TypeOrmModule,
  ],
})
export class BookingsModule {}
