import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller.js';
import { CrawlerController } from './crawler.controller.js';
import { AdminService } from './admin.service.js';
import { RapidApiCrawlerService } from './rapidapi-crawler.service.js';
import { PayoutRequest } from '../payments/entities/payout-request.entity.js';
import { ClaimRequest } from '../verification/entities/claim-request.entity.js';
import { HostVerificationDocument } from '../verification/entities/host-verification-document.entity.js';
import { Homestay } from '../homestays/entities/homestay.entity.js';
import { Room } from '../homestays/entities/room.entity.js';
import { RoomImage } from '../homestays/entities/room-image.entity.js';
import { PriceCalendar } from '../homestays/entities/price-calendar.entity.js';
import { Booking } from '../bookings/entities/booking.entity.js';
import { User } from '../users/entities/user.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PayoutRequest,
      ClaimRequest,
      HostVerificationDocument,
      Homestay,
      Room,
      RoomImage,
      PriceCalendar,
      Booking,
      User,
    ]),
  ],
  controllers: [AdminController, CrawlerController],
  providers: [AdminService, RapidApiCrawlerService],
  exports: [AdminService, RapidApiCrawlerService],
})
export class AdminModule {}
