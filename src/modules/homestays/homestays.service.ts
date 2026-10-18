import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import {
  Homestay,
  Room,
  RoomImage,
  PriceCalendar,
  HomestayStatus,
} from './entities/index.js';
import { CreateHomestayDto } from './dto/create-homestay.dto.js';
import { UpdateHomestayDto } from './dto/update-homestay.dto.js';
import { CreateRoomDto } from './dto/create-room.dto.js';
import { UpdateRoomDto } from './dto/update-room.dto.js';
import { UploadRoomImageDto } from './dto/upload-room-image.dto.js';
import { UpdateCalendarDto } from './dto/update-calendar.dto.js';
import { BatchUpdateCalendarDto } from './dto/batch-update-calendar.dto.js';

@Injectable()
export class HomestaysService {
  private readonly logger = new Logger(HomestaysService.name);

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

  // ==========================================
  // PUBLIC / CUSTOMER QUERIES
  // ==========================================

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

  // ==========================================
  // HOST HOMESTAYS MANAGEMENT
  // ==========================================

  async findMyListings(hostId: string) {
    return await this.homestayRepo.find({
      where: { host_id: hostId },
      relations: ['rooms', 'rooms.images'],
      order: { created_at: 'DESC' },
    });
  }

  async findHostHomestay(hostId: string, homestayId: string) {
    const homestay = await this.homestayRepo.findOne({
      where: { id: homestayId },
      relations: ['rooms', 'rooms.images', 'rooms.price_calendars', 'reviews'],
    });
    if (!homestay) {
      throw new NotFoundException(`Không tìm thấy homestay #${homestayId}`);
    }
    if (homestay.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu homestay này');
    }
    return homestay;
  }

  async createHomestay(hostId: string, dto: CreateHomestayDto) {
    const homestay = this.homestayRepo.create({
      ...dto,
      host_id: hostId,
      is_claimed: 1, // Tự tạo bởi Host chính chủ
      status: dto.status || HomestayStatus.ACTIVE,
      average_rating: 0,
      total_reviews: 0,
    });
    const saved = await this.homestayRepo.save(homestay);
    this.logger.log(`Host #${hostId} đã tạo mới homestay #${saved.id} (${saved.name})`);
    return saved;
  }

  async updateHomestay(hostId: string, homestayId: string, dto: UpdateHomestayDto) {
    const homestay = await this.findHostHomestay(hostId, homestayId);
    Object.assign(homestay, dto);
    const updated = await this.homestayRepo.save(homestay);
    this.logger.log(`Host #${hostId} đã cập nhật homestay #${homestayId}`);
    return updated;
  }

  async deleteHomestay(hostId: string, homestayId: string) {
    const homestay = await this.findHostHomestay(hostId, homestayId);
    await this.homestayRepo.remove(homestay);
    this.logger.log(`Host #${hostId} đã xóa homestay #${homestayId}`);
    return { message: `Đã xóa thành công homestay #${homestayId}` };
  }

  // ==========================================
  // HOST ROOM MANAGEMENT
  // ==========================================

  async createRoom(hostId: string, homestayId: string, dto: CreateRoomDto) {
    const homestay = await this.findHostHomestay(hostId, homestayId);
    const room = this.roomRepo.create({
      ...dto,
      homestay_id: homestay.id,
    });
    const saved = await this.roomRepo.save(room);
    this.logger.log(`Host #${hostId} đã thêm phòng #${saved.id} cho homestay #${homestayId}`);
    return saved;
  }

  async updateRoom(hostId: string, roomId: string, dto: UpdateRoomDto) {
    const room = await this.roomRepo.findOne({
      where: { id: roomId },
      relations: ['homestay'],
    });
    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng #${roomId}`);
    }
    if (room.homestay.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu phòng thuộc homestay này');
    }

    Object.assign(room, dto);
    return await this.roomRepo.save(room);
  }

  async deleteRoom(hostId: string, roomId: string) {
    const room = await this.roomRepo.findOne({
      where: { id: roomId },
      relations: ['homestay'],
    });
    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng #${roomId}`);
    }
    if (room.homestay.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu phòng thuộc homestay này');
    }

    await this.roomRepo.remove(room);
    return { message: `Đã xóa phòng #${roomId}` };
  }

  // ==========================================
  // HOST ROOM IMAGES
  // ==========================================

  async addRoomImage(hostId: string, roomId: string, dto: UploadRoomImageDto) {
    const room = await this.roomRepo.findOne({
      where: { id: roomId },
      relations: ['homestay'],
    });
    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng #${roomId}`);
    }
    if (room.homestay.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu phòng này');
    }

    const image = this.roomImageRepo.create({
      room_id: roomId,
      image_url: dto.image_url,
      is_primary: dto.is_primary ?? 0,
      sort_order: dto.sort_order ?? 0,
    });
    return await this.roomImageRepo.save(image);
  }

  async deleteRoomImage(hostId: string, imageId: string) {
    const image = await this.roomImageRepo.findOne({
      where: { id: imageId },
      relations: ['room', 'room.homestay'],
    });
    if (!image) {
      throw new NotFoundException(`Không tìm thấy ảnh #${imageId}`);
    }
    if (image.room.homestay.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu ảnh của phòng này');
    }

    await this.roomImageRepo.remove(image);
    return { message: `Đã xóa ảnh #${imageId}` };
  }

  // ==========================================
  // HOST PRICE & AVAILABILITY CALENDAR
  // ==========================================

  async getRoomCalendar(
    hostId: string,
    roomId: string,
    fromDate?: string,
    toDate?: string,
  ) {
    const room = await this.roomRepo.findOne({
      where: { id: roomId },
      relations: ['homestay'],
    });
    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng #${roomId}`);
    }
    if (room.homestay.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu phòng này');
    }

    const qb = this.priceCalendarRepo
      .createQueryBuilder('cal')
      .where('cal.room_id = :roomId', { roomId });

    if (fromDate && toDate) {
      qb.andWhere('cal.date BETWEEN :fromDate AND :toDate', { fromDate, toDate });
    } else if (fromDate) {
      qb.andWhere('cal.date >= :fromDate', { fromDate });
    }

    qb.orderBy('cal.date', 'ASC');
    return await qb.getMany();
  }

  async updateRoomCalendar(hostId: string, roomId: string, dto: UpdateCalendarDto) {
    const room = await this.roomRepo.findOne({
      where: { id: roomId },
      relations: ['homestay'],
    });
    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng #${roomId}`);
    }
    if (room.homestay.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu phòng này');
    }

    let cal = await this.priceCalendarRepo.findOne({
      where: { room_id: roomId, date: dto.date },
    });

    // Kiểm tra khóa chống Overbooking: nếu đang bị lock VNPay (locked_until > now)
    if (cal?.locked_until && new Date(cal.locked_until) > new Date()) {
      throw new BadRequestException(
        `Ngày ${dto.date} đang được khóa giao dịch bởi khách thanh toán VNPay, không thể chỉnh sửa lúc này.`,
      );
    }

    if (cal) {
      cal.price = dto.price;
      if (dto.is_available !== undefined) {
        cal.is_available = dto.is_available;
      }
    } else {
      cal = this.priceCalendarRepo.create({
        room_id: roomId,
        date: dto.date,
        price: dto.price,
        is_available: dto.is_available ?? 1,
      });
    }

    return await this.priceCalendarRepo.save(cal);
  }

  async batchUpdateRoomCalendar(
    hostId: string,
    roomId: string,
    dto: BatchUpdateCalendarDto,
  ) {
    const room = await this.roomRepo.findOne({
      where: { id: roomId },
      relations: ['homestay'],
    });
    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng #${roomId}`);
    }
    if (room.homestay.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu phòng này');
    }

    const start = new Date(dto.from_date);
    const end = new Date(dto.to_date);

    if (start > end) {
      throw new BadRequestException('from_date không được lớn hơn to_date');
    }

    const results: PriceCalendar[] = [];
    const current = new Date(start);

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      let cal = await this.priceCalendarRepo.findOne({
        where: { room_id: roomId, date: dateStr },
      });

      if (cal) {
        if (dto.price !== undefined) cal.price = dto.price;
        if (dto.is_available !== undefined) cal.is_available = dto.is_available;
      } else {
        cal = this.priceCalendarRepo.create({
          room_id: roomId,
          date: dateStr,
          price: dto.price ?? room.base_price,
          is_available: dto.is_available ?? 1,
        });
      }

      results.push(await this.priceCalendarRepo.save(cal));
      current.setDate(current.getDate() + 1);
    }

    return {
      message: `Đã cập nhật ${results.length} ngày trong lịch phòng`,
      updated_count: results.length,
    };
  }
}
