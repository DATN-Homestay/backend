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
import { HostHomestaysController } from './host-homestays.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Homestay, Room, RoomImage, PriceCalendar])],
  controllers: [HomestaysController, HostHomestaysController],
  providers: [HomestaysService],
  exports: [HomestaysService, TypeOrmModule],
})
export class HomestaysModule {}
