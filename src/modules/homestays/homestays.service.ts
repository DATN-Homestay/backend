import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Homestay,
  Room,
  RoomImage,
  PriceCalendar,
} from './entities/index.js';

@Injectable()
export class HomestaysService {
  constructor(
    @InjectRepository(Homestay)
    private readonly homestayRepo: Repository<Homestay>,
    @InjectRepository(Room)
    private readonly roomRepo: Repository<Room>,
    @InjectRepository(RoomImage)
    private readonly roomImageRepo: Repository<RoomImage>,
    @InjectRepository(PriceCalendar)
    private readonly priceCalendarRepo: Repository<PriceCalendar>,
  ) {}

  async findAll(city?: string, limit: number = 20, offset: number = 0) {
    const qb = this.homestayRepo
      .createQueryBuilder('homestay')
      .leftJoinAndSelect('homestay.rooms', 'room')
      .leftJoinAndSelect('room.images', 'image')
      .take(limit)
      .skip(offset);

    if (city) {
      qb.where('homestay.city LIKE :city', { city: `%${city}%` });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total, limit, offset };
  }

  async findOne(id: string) {
    const homestay = await this.homestayRepo.findOne({
      where: { id },
      relations: ['rooms', 'rooms.images', 'reviews', 'absa_metric'],
    });
    if (!homestay) {
      throw new NotFoundException(`Không tìm thấy homestay ID: ${id}`);
    }
    return homestay;
  }
}
