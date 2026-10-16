import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Homestay,
  Room,
  RoomImage,
  PriceCalendar,
} from './entities/index.js';
import { HomestaysService } from './homestays.service.js';
import { HomestaysController } from './homestays.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Homestay, Room, RoomImage, PriceCalendar])],
  controllers: [HomestaysController],
  providers: [HomestaysService],
  exports: [HomestaysService],
})
export class HomestaysModule {}
