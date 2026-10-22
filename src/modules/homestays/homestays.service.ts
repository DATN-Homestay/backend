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

  // In-memory cache với TTL 30 giây giúp phản hồi siêu tốc (<5ms)
  private listCache = new Map<string, { data: any; expiresAt: number }>();

  async findAll(city?: string, limit: number = 1000, offset: number = 0) {
    const cacheKey = `${city || 'all'}_${limit}_${offset}`;
    const cached = this.listCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    // Tối ưu: Chỉ join ảnh chính (is_primary = 1 hoặc sort_order = 0) cho danh sách hiển thị
    // Chú ý: Chỉ orderBy('homestay.id') để TypeORM DISTINCT trên homestay, tránh bị limit theo số lượng room/image
    const qb = this.homestayRepo
      .createQueryBuilder('homestay')
      .leftJoinAndSelect('homestay.rooms', 'room')
      .leftJoinAndSelect(
        'room.images',
        'image',
        'image.is_primary = 1 OR image.sort_order = 0',
      )
      .orderBy('homestay.id', 'DESC')
      .take(limit)
      .skip(offset);

    if (city) {
      qb.where('(homestay.city LIKE :city OR homestay.address LIKE :city OR homestay.name LIKE :city)', { city: `%${city}%` });
    }

    const [items, total] = await qb.getManyAndCount();
    const result = { items, total, limit, offset };

    // Lưu cache 30 giây
    this.listCache.set(cacheKey, { data: result, expiresAt: Date.now() + 30000 });

    return result;
  }

  async findOne(id: string) {
    const homestay = await this.homestayRepo.findOne({
      where: { id },
      relations: ['rooms', 'rooms.images', 'reviews', 'absa_metric'],
      order: {
        rooms: {
          id: 'ASC',
          images: {
            sort_order: 'ASC',
          },
        },
      },
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

  async getHomestayTotalPhotoCount(homestayId: string): Promise<number> {
    const homestay = await this.homestayRepo.findOne({
      where: { id: homestayId },
      relations: ['rooms', 'rooms.images'],
    });
    if (!homestay) return 0;
    const propertyImages = (homestay.amenities_json?.property_images as string[]) || [];
    const roomImagesCount = (homestay.rooms || []).reduce(
      (sum, room) => sum + (room.images ? room.images.length : 0),
      0,
    );
    return propertyImages.length + roomImagesCount;
  }

  async createHomestay(hostId: string, dto: CreateHomestayDto) {
    const propertyImages = dto.property_images || dto.amenities_json?.property_images || [];
    if (propertyImages.length > 100) {
      throw new BadRequestException('Một homestay chỉ được tải lên tối đa 100 ảnh');
    }

    const amenities = {
      ...(dto.amenities_json || {}),
      property_images: propertyImages,
      main_image_url: dto.main_image_url || propertyImages[0] || dto.amenities_json?.main_image_url || null,
    };

    const homestay = this.homestayRepo.create({
      ...dto,
      host_id: hostId,
      is_claimed: 1, // Tự tạo bởi Host chính chủ
      status: dto.status || HomestayStatus.ACTIVE,
      average_rating: 0,
      total_reviews: 0,
      amenities_json: amenities,
    });
    const saved = await this.homestayRepo.save(homestay);
    this.listCache.clear();
    this.logger.log(`Host #${hostId} đã tạo mới homestay #${saved.id} (${saved.name}) với ${propertyImages.length} ảnh`);
    return saved;
  }

  async updateHomestay(hostId: string, homestayId: string, dto: UpdateHomestayDto) {
    const homestay = await this.findHostHomestay(hostId, homestayId);

    // Kiểm tra và cập nhật ảnh homestay
    const newPropertyImages = dto.property_images ?? dto.amenities_json?.property_images;
    if (newPropertyImages !== undefined) {
      const currentRoomImagesCount = (homestay.rooms || []).reduce(
        (sum, room) => sum + (room.images ? room.images.length : 0),
        0,
      );
      if (newPropertyImages.length + currentRoomImagesCount > 100) {
        throw new BadRequestException(
          `Tổng số lượng ảnh của homestay không được vượt quá 100 ảnh (Hiện có: ${currentRoomImagesCount} ảnh phòng, bạn đang chọn ${newPropertyImages.length} ảnh homestay)`,
        );
      }

      homestay.amenities_json = {
        ...(homestay.amenities_json || {}),
        property_images: newPropertyImages,
        main_image_url: dto.main_image_url || newPropertyImages[0] || homestay.amenities_json?.main_image_url || null,
      };
    }

    Object.assign(homestay, dto);
    if (newPropertyImages !== undefined) {
      homestay.amenities_json = {
        ...(homestay.amenities_json || {}),
        property_images: newPropertyImages,
        main_image_url: dto.main_image_url || newPropertyImages[0] || homestay.amenities_json?.main_image_url || null,
      };
    }

    const updated = await this.homestayRepo.save(homestay);
    this.listCache.clear();
    this.logger.log(`Host #${hostId} đã cập nhật homestay #${homestayId}`);
    return updated;
  }

  async deleteHomestay(hostId: string, homestayId: string) {
    const homestay = await this.findHostHomestay(hostId, homestayId);
    await this.homestayRepo.remove(homestay);
    this.listCache.clear();
    this.logger.log(`Host #${hostId} đã xóa homestay #${homestayId}`);
    return { message: `Đã xóa thành công homestay #${homestayId}` };
  }

  // ==========================================
  // HOST ROOM MANAGEMENT
  // ==========================================

  async createRoom(hostId: string, homestayId: string, dto: CreateRoomDto) {
    const homestay = await this.findHostHomestay(hostId, homestayId);
    const roomImages = dto.images || [];

    // Kiểm tra tổng số ảnh toàn homestay (tối đa 100 ảnh)
    const currentTotalPhotos = await this.getHomestayTotalPhotoCount(homestayId);
    if (currentTotalPhotos + roomImages.length > 100) {
      throw new BadRequestException(
        `Homestay này đã có ${currentTotalPhotos} ảnh. Thêm ${roomImages.length} ảnh phòng này sẽ vượt quá giới hạn tối đa 100 ảnh.`,
      );
    }

    const room = this.roomRepo.create({
      room_name: dto.room_name,
      capacity: dto.capacity,
      base_price: dto.base_price,
      homestay_id: homestay.id,
    });
    const saved = await this.roomRepo.save(room);

    // Lưu ảnh phòng nếu có
    if (roomImages.length > 0) {
      const imageEntities = roomImages.map((url, idx) =>
        this.roomImageRepo.create({
          room_id: saved.id,
          image_url: url,
          is_primary: idx === 0 ? 1 : 0,
          sort_order: idx,
        }),
      );
      await this.roomImageRepo.save(imageEntities);
    }

    this.listCache.clear();
    this.logger.log(`Host #${hostId} đã thêm phòng #${saved.id} (${roomImages.length} ảnh) cho homestay #${homestayId}`);
    return await this.roomRepo.findOne({
      where: { id: saved.id },
      relations: ['images'],
    });
  }

  async updateRoom(hostId: string, roomId: string, dto: UpdateRoomDto) {
    const room = await this.roomRepo.findOne({
      where: { id: roomId },
      relations: ['homestay', 'images'],
    });
    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng #${roomId}`);
    }
    if (room.homestay.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu phòng thuộc homestay này');
    }

    if (dto.images !== undefined) {
      const currentTotalPhotos = await this.getHomestayTotalPhotoCount(room.homestay_id);
      const currentRoomPhotosCount = room.images ? room.images.length : 0;
      const netPhotoChange = dto.images.length - currentRoomPhotosCount;
      if (currentTotalPhotos + netPhotoChange > 100) {
        throw new BadRequestException(
          `Cập nhật ảnh phòng này sẽ vượt quá giới hạn tối đa 100 ảnh của homestay (Hiện có: ${currentTotalPhotos} ảnh).`,
        );
      }

      // Thay thế danh sách ảnh phòng
      if (room.images && room.images.length > 0) {
        await this.roomImageRepo.remove(room.images);
      }
      if (dto.images.length > 0) {
        const imageEntities = dto.images.map((url, idx) =>
          this.roomImageRepo.create({
            room_id: room.id,
            image_url: url,
            is_primary: idx === 0 ? 1 : 0,
            sort_order: idx,
          }),
        );
        await this.roomImageRepo.save(imageEntities);
      }
    }

    Object.assign(room, {
      room_name: dto.room_name ?? room.room_name,
      capacity: dto.capacity ?? room.capacity,
      base_price: dto.base_price ?? room.base_price,
    });
    const updated = await this.roomRepo.save(room);
    this.listCache.clear();
    return updated;
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
    this.listCache.clear();
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

    const currentTotalPhotos = await this.getHomestayTotalPhotoCount(room.homestay_id);
    if (currentTotalPhotos >= 100) {
      throw new BadRequestException('Homestay đã đạt giới hạn tối đa 100 ảnh. Không thể tải thêm.');
    }

    const image = this.roomImageRepo.create({
      room_id: roomId,
      image_url: dto.image_url,
      is_primary: dto.is_primary ?? 0,
      sort_order: dto.sort_order ?? 0,
    });
    const saved = await this.roomImageRepo.save(image);
    this.listCache.clear();
    return saved;
  }

  async batchUploadRoomImages(hostId: string, roomId: string, imageUrls: string[]) {
    const room = await this.roomRepo.findOne({
      where: { id: roomId },
      relations: ['homestay', 'images'],
    });
    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng #${roomId}`);
    }
    if (room.homestay.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu phòng này');
    }

    const currentTotalPhotos = await this.getHomestayTotalPhotoCount(room.homestay_id);
    if (currentTotalPhotos + imageUrls.length > 100) {
      throw new BadRequestException(
        `Homestay này đã có ${currentTotalPhotos} ảnh. Thêm ${imageUrls.length} ảnh sẽ vượt quá giới hạn 100 ảnh.`,
      );
    }

    const currentMaxSort = (room.images || []).reduce((max, img) => Math.max(max, img.sort_order || 0), -1);
    const hasPrimary = (room.images || []).some((img) => img.is_primary === 1);

    const entities = imageUrls.map((url, idx) =>
      this.roomImageRepo.create({
        room_id: roomId,
        image_url: url,
        is_primary: !hasPrimary && idx === 0 ? 1 : 0,
        sort_order: currentMaxSort + 1 + idx,
      }),
    );
    const saved = await this.roomImageRepo.save(entities);
    this.listCache.clear();
    return saved;
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
    this.listCache.clear();
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

  async getHostDashboardStats(hostId: string) {
    const homestays = await this.homestayRepo.find({
      where: { host_id: hostId },
      relations: ['rooms'],
      order: { created_at: 'DESC' },
    });

    const totalHomestays = homestays.length;
    const totalRooms = homestays.reduce(
      (sum, h) => sum + (h.rooms?.length || 0),
      0,
    );
    const verifiedCount = homestays.filter((h) => h.is_claimed === 1).length;

    return {
      statusCode: 200,
      data: {
        totalHomestays,
        totalRooms,
        verifiedCount,
        homestays: homestays.map((h) => ({
          id: h.id,
          name: h.name,
          city: h.city,
          address: h.address,
          is_claimed: h.is_claimed,
          status: h.status,
          average_rating: h.average_rating,
          total_reviews: h.total_reviews,
          rooms_count: h.rooms?.length || 0,
        })),
      },
    };
  }
}

