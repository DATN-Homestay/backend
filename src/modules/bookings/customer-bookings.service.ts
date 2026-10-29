import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Booking, BookingStatus } from './entities/booking.entity.js';
import { Room } from '../homestays/entities/room.entity.js';
import {
  Homestay,
  HomestayStatus,
} from '../homestays/entities/homestay.entity.js';
import { PriceCalendar } from '../homestays/entities/price-calendar.entity.js';
import { RoleType } from '../users/entities/role.entity.js';
import type { AuthUser } from '../auth/auth.types.js';
import { QuoteBookingDto } from './dto/quote-booking.dto.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';
import { ListBookingsDto } from './dto/list-bookings.dto.js';
import {
  daysBetween,
  generateBookingCode,
  isRealDate,
  listNights,
  todayVn,
  toVnd,
} from './booking.utils.js';

/** Thời gian giữ chỗ chờ thanh toán VNPay (BR-007) */
export const HOLD_MINUTES = 15;
const MAX_NIGHTS = 30;
const MAX_ADVANCE_DAYS = 365;

interface StayContext {
  room: Room;
  homestay: Homestay;
  nights: string[];
  numGuests: number;
}

/**
 * Customer Bookings Service - Báo giá, đặt phòng giữ chỗ chống Overbooking, xem đơn của khách.
 * Quy tắc BK-01 → BK-05 trong docs/design/07_Module1_Ke_hoach_Trien_khai.md
 */
@Injectable()
export class CustomerBookingsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Room)
    private readonly roomRepo: Repository<Room>,
    @InjectRepository(PriceCalendar)
    private readonly calendarRepo: Repository<PriceCalendar>,
  ) {}

  // =========================================================
  // BÁO GIÁ (không giữ chỗ)
  // =========================================================

  async quote(dto: QuoteBookingDto) {
    const stay = await this.resolveStay(dto);
    const rows = await this.calendarRepo.find({
      where: { room_id: stay.room.id, date: In(stay.nights) },
      order: { date: 'ASC' },
    });

    const normalizeDate = (d: any) =>
      typeof d === 'string' ? d.slice(0, 10) : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);

    const byDate = new Map(rows.map((r) => [normalizeDate(r.date), r]));
    const defaultPrice = toVnd(stay.room.base_price) || 500000;

    // Nếu chưa có lịch giá cho ngày d thì fallback về base_price và coi là còn phòng.
    // Chỉ coi là unavailable khi ngày đó đã có bản ghi và is_available !== 1.
    const unavailable = stay.nights.filter((d) => {
      const row = byDate.get(d);
      if (!row) return false;
      return Number(row.is_available) !== 1;
    });

    const nightlyPrices = stay.nights.map((d) => {
      const row = byDate.get(d);
      return {
        date: d,
        price: row ? toVnd(row.price) : defaultPrice,
      };
    });
    const roomSubtotal = nightlyPrices.reduce((sum, n) => sum + n.price, 0);

    return {
      available: unavailable.length === 0,
      unavailable_dates: unavailable,
      room_id: stay.room.id,
      room_name: stay.room.room_name,
      homestay: { id: stay.homestay.id, name: stay.homestay.name },
      check_in_date: stay.nights[0],
      check_out_date: dto.check_out_date,
      nights: stay.nights.length,
      num_guests: stay.numGuests,
      nightly_prices: nightlyPrices,
      room_subtotal: roomSubtotal,
      discount_amount: 0,
      total_amount: roomSubtotal,
      cancellation_policy: stay.homestay.cancellation_policy,
      is_dropship: stay.homestay.is_claimed === 0,
    };
  }

  // =========================================================
  // ĐẶT PHÒNG & GIỮ CHỖ 15 PHÚT
  // =========================================================

  /**
   * Chống Overbooking (BR-007): khóa dòng lịch giá bằng SELECT ... FOR UPDATE trong một
   * transaction NGẮN (vài mili-giây), sau đó đánh dấu giữ chỗ bằng is_available = 0 và
   * locked_until. Không giữ transaction 15 phút; hết hạn do BookingExpiryService mở lại.
   * Nếu ngày chưa có trong price_calendars thì tự động khởi tạo theo room.base_price.
   */
  async createBooking(authUser: AuthUser, dto: CreateBookingDto) {
    const stay = await this.resolveStay(dto);

    if (stay.homestay.host_id === authUser.id) {
      throw new ForbiddenException('Bạn không thể đặt phòng tại homestay của chính mình');
    }

    const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);
    const bookingCode = generateBookingCode();

    const booking = await this.dataSource.transaction('READ COMMITTED', async (em) => {
      // Sắp xếp theo date để mọi transaction khóa cùng một thứ tự, tránh deadlock
      const rows = await em
        .createQueryBuilder(PriceCalendar, 'pc')
        .setLock('pessimistic_write')
        .where('pc.room_id = :roomId', { roomId: stay.room.id })
        .andWhere('pc.date IN (:...dates)', { dates: stay.nights })
        .orderBy('pc.date', 'ASC')
        .getMany();

      const normalizeDate = (d: any) =>
        typeof d === 'string' ? d.slice(0, 10) : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);

      const byDate = new Map(rows.map((r) => [normalizeDate(r.date), r]));
      const defaultPrice = toVnd(stay.room.base_price) || 500000;

      // Kiểm tra xem có ngày nào thực sự đã bị kín phòng không
      const unavailable = stay.nights.filter((d) => {
        const row = byDate.get(d);
        if (!row) return false;
        return Number(row.is_available) !== 1;
      });

      if (unavailable.length > 0) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message:
            'Phòng đã có người giữ chỗ trong khoảng thời gian này, vui lòng chọn ngày hoặc phòng khác.',
          unavailable_dates: unavailable,
        });
      }

      // Đối với các ngày đã có trong price_calendars: Cập nhật giữ chỗ
      const existingRowsToLock = rows.filter((r) => stay.nights.includes(normalizeDate(r.date)));
      if (existingRowsToLock.length > 0) {
        await em.update(
          PriceCalendar,
          { id: In(existingRowsToLock.map((r) => r.id)) },
          { is_available: 0, locked_until: expiresAt },
        );
      }

      // Đối với các ngày chưa có trong price_calendars: Tự động khởi tạo dòng mới với trạng thái locked
      const missingDates = stay.nights.filter((d) => !byDate.has(d));
      for (const d of missingDates) {
        const newRow = em.create(PriceCalendar, {
          room_id: stay.room.id,
          date: d as any,
          price: defaultPrice,
          is_available: 0,
          locked_until: expiresAt,
        });
        const saved = await em.save(newRow);
        byDate.set(d, saved);
      }

      // Zero-Trust (BR-009): tiền tính từ các ngày thực tế
      const allNightPrices = stay.nights.map((d) => {
        const row = byDate.get(d);
        return row ? toVnd(row.price) : defaultPrice;
      });
      const roomSubtotal = allNightPrices.reduce((sum, p) => sum + p, 0);

      return em.save(
        em.create(Booking, {
          booking_code: bookingCode,
          customer_id: authUser.id,
          room_id: stay.room.id,
          check_in_date: stay.nights[0],
          check_out_date: dto.check_out_date,
          num_guests: stay.numGuests,
          room_subtotal: roomSubtotal,
          service_fee: 0,
          discount_amount: 0,
          total_amount: roomSubtotal,
          customer_note: dto.customer_note ?? null,
          is_dropship: stay.homestay.is_claimed === 0 ? 1 : 0,
          status: BookingStatus.PENDING_PAYMENT,
          expires_at: expiresAt,
        }),
      );
    });

    return {
      id: booking.id,
      booking_code: booking.booking_code,
      status: booking.status,
      room_name: stay.room.room_name,
      homestay_name: stay.homestay.name,
      check_in_date: booking.check_in_date,
      check_out_date: booking.check_out_date,
      nights: stay.nights.length,
      num_guests: booking.num_guests,
      total_amount: toVnd(booking.total_amount),
      is_dropship: booking.is_dropship === 1,
      payment_deadline: expiresAt.toISOString(),
    };
  }

  // =========================================================
  // XEM ĐƠN
  // =========================================================

  async listMine(authUser: AuthUser, query: ListBookingsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const [items, total] = await this.bookingRepo.findAndCount({
      where: {
        customer_id: authUser.id,
        ...(query.status ? { status: query.status } : {}),
      },
      relations: { room: { homestay: true } },
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: items.map((b) => ({
        id: b.id,
        booking_code: b.booking_code,
        status: b.status,
        homestay: { id: b.room.homestay.id, name: b.room.homestay.name, city: b.room.homestay.city },
        room: { id: b.room.id, room_name: b.room.room_name },
        check_in_date: b.check_in_date,
        check_out_date: b.check_out_date,
        total_amount: toVnd(b.total_amount),
        is_dropship: b.is_dropship === 1,
        ota_fulfillment: b.ota_fulfillment_json ?? null,
        expires_at: b.status === BookingStatus.PENDING_PAYMENT ? b.expires_at : null,
        created_at: b.created_at,
      })),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    };
  }

  /** Chủ đơn, Host của homestay hoặc Admin mới xem được; người khác nhận 404 để không lộ sự tồn tại */
  async getDetail(authUser: AuthUser, id: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id },
      relations: { room: { homestay: true }, payments: true, escrow: true, refunds: true },
    });

    const homestay = booking?.room?.homestay;
    const allowed =
      !!booking &&
      (booking.customer_id === authUser.id ||
        homestay?.host_id === authUser.id ||
        authUser.roles.includes(RoleType.ADMIN));
    if (!booking || !homestay || !allowed) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng');
    }

    return {
      id: booking.id,
      booking_code: booking.booking_code,
      status: booking.status,
      is_dropship: booking.is_dropship === 1,
      ota_fulfillment: booking.ota_fulfillment_json ?? null,
      homestay: {
        id: homestay.id,
        name: homestay.name,
        address: homestay.address,
        city: homestay.city,
        cancellation_policy: homestay.cancellation_policy,
      },
      room: { id: booking.room.id, room_name: booking.room.room_name },
      check_in_date: booking.check_in_date,
      check_out_date: booking.check_out_date,
      nights: daysBetween(booking.check_in_date, booking.check_out_date),
      num_guests: booking.num_guests,
      customer_note: booking.customer_note,
      room_subtotal: toVnd(booking.room_subtotal),
      discount_amount: toVnd(booking.discount_amount),
      total_amount: toVnd(booking.total_amount),
      payment_deadline:
        booking.status === BookingStatus.PENDING_PAYMENT ? booking.expires_at : null,
      payments: (booking.payments ?? []).map((p) => ({
        id: p.id,
        amount: toVnd(p.amount),
        method: p.payment_method,
        status: p.status,
        transaction_code: p.transaction_code,
        created_at: p.created_at,
      })),
      escrow_status: booking.escrow?.status ?? null,
      cancelled_at: booking.cancelled_at,
      cancelled_by: booking.cancelled_by,
      cancel_reason: booking.cancel_reason,
      refunds: (booking.refunds ?? []).map((r) => ({
        id: r.id,
        amount: toVnd(r.refund_amount),
        status: r.status,
        source: r.source,
        reason: r.reason,
        processed_at: r.processed_at,
        created_at: r.created_at,
      })),
      created_at: booking.created_at,
    };
  }

  // =========================================================
  // PRIVATE HELPERS
  // =========================================================

  /** Kiểm tra đầu vào dùng chung cho báo giá và đặt phòng (BK-01, BK-03) */
  private async resolveStay(dto: QuoteBookingDto): Promise<StayContext> {
    const { check_in_date: checkIn, check_out_date: checkOut } = dto;
    if (!isRealDate(checkIn) || !isRealDate(checkOut)) {
      throw new BadRequestException('Ngày nhận/trả phòng không hợp lệ');
    }

    const nights = daysBetween(checkIn, checkOut);
    if (nights < 1) {
      throw new BadRequestException('Ngày trả phòng phải sau ngày nhận phòng');
    }
    if (nights > MAX_NIGHTS) {
      throw new BadRequestException(`Mỗi đơn đặt tối đa ${MAX_NIGHTS} đêm`);
    }

    const today = todayVn();
    if (checkIn < today) {
      throw new BadRequestException('Ngày nhận phòng không được ở trong quá khứ');
    }
    if (daysBetween(today, checkIn) > MAX_ADVANCE_DAYS) {
      throw new BadRequestException(`Chỉ nhận đặt trước tối đa ${MAX_ADVANCE_DAYS} ngày`);
    }

    const room = await this.roomRepo.findOne({
      where: { id: dto.room_id },
      relations: { homestay: true },
    });
    const homestay = room?.homestay;
    if (!room || !homestay || homestay.status !== HomestayStatus.ACTIVE) {
      throw new NotFoundException('Không tìm thấy phòng');
    }

    const numGuests = dto.num_guests ?? 1;
    if (numGuests > room.capacity) {
      throw new BadRequestException(`Phòng này chỉ chứa tối đa ${room.capacity} khách`);
    }

    return { room, homestay, nights: listNights(checkIn, checkOut), numGuests };
  }
}
