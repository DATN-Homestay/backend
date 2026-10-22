import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { CustomerBookingsService } from './customer-bookings.service.js';
import { Booking, BookingStatus } from './entities/booking.entity.js';
import { Room } from '../homestays/entities/room.entity.js';
import { HomestayStatus } from '../homestays/entities/homestay.entity.js';
import { PriceCalendar } from '../homestays/entities/price-calendar.entity.js';
import { RoleType } from '../users/entities/role.entity.js';
import type { AuthUser } from '../auth/auth.types.js';
import { addDays, todayVn } from './booking.utils.js';

const mockRepo = () => ({
  find: vi.fn(),
  findOne: vi.fn(),
  findAndCount: vi.fn(),
});

const customer: AuthUser = { id: '15', email: 'c@x.vn', roles: [RoleType.CUSTOMER], session_id: '1' };
const stranger: AuthUser = { id: '99', email: 's@x.vn', roles: [RoleType.CUSTOMER], session_id: '2' };
const hostUser: AuthUser = { id: '10', email: 'h@x.vn', roles: [RoleType.CUSTOMER, RoleType.HOST], session_id: '3' };
const admin: AuthUser = { id: '1', email: 'a@x.vn', roles: [RoleType.ADMIN], session_id: '4' };

const checkIn = addDays(todayVn(), 5);
const checkOut = addDays(todayVn(), 7);

const makeRoom = (overrides: Record<string, unknown> = {}) =>
  ({
    id: '10',
    room_name: 'Deluxe',
    capacity: 2,
    homestay: {
      id: '1',
      name: 'Villa Tây Hồ',
      address: '123 Xuân Diệu',
      city: 'Hà Nội',
      host_id: '10',
      is_claimed: 1,
      status: HomestayStatus.ACTIVE,
      cancellation_policy: 'FLEXIBLE',
    },
    ...overrides,
  }) as unknown as Room;

const dto = (overrides: Record<string, unknown> = {}) => ({
  room_id: '10',
  check_in_date: checkIn,
  check_out_date: checkOut,
  num_guests: 2,
  ...overrides,
});

describe('CustomerBookingsService', () => {
  let service: CustomerBookingsService;
  let bookingRepo: ReturnType<typeof mockRepo>;
  let roomRepo: ReturnType<typeof mockRepo>;
  let calendarRepo: ReturnType<typeof mockRepo>;
  let dataSource: { transaction: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    bookingRepo = mockRepo();
    roomRepo = mockRepo();
    calendarRepo = mockRepo();
    dataSource = { transaction: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerBookingsService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: getRepositoryToken(Booking), useValue: bookingRepo },
        { provide: getRepositoryToken(Room), useValue: roomRepo },
        { provide: getRepositoryToken(PriceCalendar), useValue: calendarRepo },
      ],
    }).compile();

    service = module.get(CustomerBookingsService);
    roomRepo.findOne.mockResolvedValue(makeRoom());
  });

  // =========================================================
  // VALIDATE ĐẦU VÀO (BK-01, BK-03)
  // =========================================================

  describe('kiểm tra đầu vào', () => {
    it('nên từ chối ngày không có thật (31/02)', async () => {
      await expect(service.quote(dto({ check_in_date: '2027-02-31' }))).rejects.toThrow(
        'không hợp lệ',
      );
    });

    it('nên từ chối ngày trả phòng không sau ngày nhận phòng', async () => {
      await expect(service.quote(dto({ check_out_date: checkIn }))).rejects.toThrow(
        'sau ngày nhận phòng',
      );
    });

    it('nên từ chối ngày nhận phòng trong quá khứ', async () => {
      await expect(
        service.quote(dto({ check_in_date: addDays(todayVn(), -1), check_out_date: todayVn() })),
      ).rejects.toThrow('quá khứ');
    });

    it('nên từ chối đặt quá 30 đêm', async () => {
      await expect(
        service.quote(dto({ check_out_date: addDays(checkIn, 31) })),
      ).rejects.toThrow('tối đa 30 đêm');
    });

    it('nên từ chối đặt trước quá 365 ngày', async () => {
      const far = addDays(todayVn(), 400);
      await expect(
        service.quote(dto({ check_in_date: far, check_out_date: addDays(far, 1) })),
      ).rejects.toThrow('365 ngày');
    });

    it('nên từ chối số khách vượt sức chứa', async () => {
      await expect(service.quote(dto({ num_guests: 3 }))).rejects.toThrow('tối đa 2 khách');
    });

    it('nên trả 404 khi phòng không tồn tại', async () => {
      roomRepo.findOne.mockResolvedValue(null);
      await expect(service.quote(dto())).rejects.toThrow(NotFoundException);
    });

    it('nên trả 404 khi homestay không còn ACTIVE', async () => {
      const room = makeRoom();
      room.homestay.status = HomestayStatus.BANNED;
      roomRepo.findOne.mockResolvedValue(room);
      await expect(service.quote(dto())).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================
  // BÁO GIÁ
  // =========================================================

  describe('quote()', () => {
    it('nên cộng giá theo số nguyên dù DB trả decimal dạng chuỗi', async () => {
      calendarRepo.find.mockResolvedValue([
        { date: checkIn, price: '900000.00', is_available: 1 },
        { date: addDays(checkIn, 1), price: '1100000.00', is_available: 1 },
      ]);

      const result = await service.quote(dto());

      expect(result.available).toBe(true);
      expect(result.nights).toBe(2);
      expect(result.room_subtotal).toBe(2000000);
      expect(result.total_amount).toBe(2000000);
      expect(result.nightly_prices).toEqual([
        { date: checkIn, price: 900000 },
        { date: addDays(checkIn, 1), price: 1100000 },
      ]);
    });

    it('nên báo không còn phòng và liệt kê ngày hết, kể cả ngày thiếu dữ liệu lịch', async () => {
      calendarRepo.find.mockResolvedValue([
        { date: checkIn, price: '900000.00', is_available: 0 },
      ]);

      const result = await service.quote(dto());

      expect(result.available).toBe(false);
      expect(result.unavailable_dates).toEqual([checkIn, addDays(checkIn, 1)]);
      // Đêm đầu có dòng giá nhưng đã bị giữ; đêm sau chưa có dòng giá (chưa mở bán)
      expect(result.held_dates).toEqual([checkIn]);
      expect(result.no_price_dates).toEqual([addDays(checkIn, 1)]);
    });

    it('nên đánh dấu is_dropship với homestay chưa có chủ', async () => {
      const room = makeRoom();
      room.homestay.is_claimed = 0;
      roomRepo.findOne.mockResolvedValue(room);
      calendarRepo.find.mockResolvedValue([]);

      expect((await service.quote(dto())).is_dropship).toBe(true);
    });
  });

  // =========================================================
  // ĐẶT PHÒNG
  // =========================================================

  describe('createBooking()', () => {
    it('nên cấm Host đặt homestay của chính mình, không mở transaction', async () => {
      await expect(service.createBooking(hostUser, dto())).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('nên mở transaction READ COMMITTED và trả hạn thanh toán 15 phút', async () => {
      dataSource.transaction.mockImplementation(async (_level: string, work: unknown) => {
        void work;
        return {
          id: '100',
          booking_code: 'BK-TEST',
          status: BookingStatus.PENDING_PAYMENT,
          check_in_date: checkIn,
          check_out_date: checkOut,
          num_guests: 2,
          total_amount: '2000000.00',
          is_dropship: 0,
        };
      });
      const before = Date.now();

      const result = await service.createBooking(customer, dto());

      expect(dataSource.transaction.mock.calls[0][0]).toBe('READ COMMITTED');
      expect(result.total_amount).toBe(2000000);
      const deadline = new Date(result.payment_deadline).getTime();
      expect(deadline - before).toBeGreaterThanOrEqual(15 * 60 * 1000 - 1000);
      expect(deadline - before).toBeLessThanOrEqual(15 * 60 * 1000 + 2000);
    });
  });

  // =========================================================
  // XEM ĐƠN
  // =========================================================

  describe('getDetail()', () => {
    const booking = () =>
      ({
        id: '100',
        booking_code: 'BK-TEST',
        status: BookingStatus.PENDING_PAYMENT,
        customer_id: '15',
        is_dropship: 0,
        check_in_date: checkIn,
        check_out_date: checkOut,
        num_guests: 2,
        customer_note: null,
        room_subtotal: '2000000.00',
        discount_amount: '0.00',
        total_amount: '2000000.00',
        expires_at: new Date(),
        created_at: new Date(),
        room: makeRoom(),
        payments: [],
        escrow: null,
      }) as unknown as Booking;

    it('nên cho chủ đơn, Host của homestay và Admin xem', async () => {
      bookingRepo.findOne.mockResolvedValue(booking());

      for (const user of [customer, hostUser, admin]) {
        const result = await service.getDetail(user, '100');
        expect(result.booking_code).toBe('BK-TEST');
        expect(result.total_amount).toBe(2000000);
        expect(result.nights).toBe(2);
      }
    });

    it('nên trả 404 (không phải 403) cho người lạ để không lộ sự tồn tại của đơn', async () => {
      bookingRepo.findOne.mockResolvedValue(booking());
      await expect(service.getDetail(stranger, '100')).rejects.toThrow(NotFoundException);
    });

    it('nên trả 404 khi đơn không tồn tại', async () => {
      bookingRepo.findOne.mockResolvedValue(null);
      await expect(service.getDetail(customer, '999')).rejects.toThrow(NotFoundException);
    });

    it('nên ẩn payment_deadline khi đơn không còn chờ thanh toán', async () => {
      const paid = booking();
      paid.status = BookingStatus.PAID_ESCROW;
      bookingRepo.findOne.mockResolvedValue(paid);

      expect((await service.getDetail(customer, '100')).payment_deadline).toBeNull();
    });
  });

  describe('listMine()', () => {
    it('nên chỉ lọc theo customer_id của người gọi và phân trang', async () => {
      bookingRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.listMine(customer, { status: BookingStatus.PAID_ESCROW, page: 2, limit: 5 });

      const query = bookingRepo.findAndCount.mock.calls[0][0];
      expect(query.where).toEqual({ customer_id: '15', status: BookingStatus.PAID_ESCROW });
      expect(query).toMatchObject({ skip: 5, take: 5 });
      expect(result.meta).toEqual({ page: 2, limit: 5, total: 0, total_pages: 0 });
    });
  });

  it('BadRequestException được dùng cho lỗi đầu vào (kiểm tra kiểu lỗi)', async () => {
    await expect(service.quote(dto({ check_in_date: 'abc' }))).rejects.toThrow(BadRequestException);
  });
});
