import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { CustomerBookingsService } from '../src/modules/bookings/customer-bookings.service.js';
import { BookingExpiryService } from '../src/modules/bookings/booking-expiry.service.js';
import {
  Booking,
  BookingStatus,
} from '../src/modules/bookings/entities/booking.entity.js';
import { Room } from '../src/modules/homestays/entities/room.entity.js';
import { Homestay } from '../src/modules/homestays/entities/homestay.entity.js';
import { PriceCalendar } from '../src/modules/homestays/entities/price-calendar.entity.js';
import { User } from '../src/modules/users/entities/user.entity.js';
import { addDays, todayVn } from '../src/modules/bookings/booking.utils.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';

/**
 * Kiểm thử chống Overbooking (AT-07, BR-007) trên MySQL THẬT.
 * Mock không chứng minh được SELECT ... FOR UPDATE, nên test này cần một MySQL 8.
 *
 * Chạy:  IT_DB_PORT=3317 IT_DB_NAME=stayai_it npm run test:e2e -- booking-concurrency
 * Biến:  IT_DB_HOST (127.0.0.1), IT_DB_PORT, IT_DB_USER (root), IT_DB_PASSWORD (rỗng), IT_DB_NAME
 *
 * AN TOÀN: test XÓA SẠCH schema của DB đích nên chỉ chạy khi IT_DB_NAME chứa
 * "test", "_it" hoặc "e2e". Không bao giờ trỏ vào DB dùng chung của nhóm.
 */
const dbName = process.env.IT_DB_NAME ?? '';
const enabled = !!process.env.IT_DB_PORT && /(test|_it|e2e)/i.test(dbName);

// Gom mọi entity của dự án (lớp có decorator), bỏ qua enum xuất cùng file
const modules = (import.meta as any).glob('../src/**/*.entity.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;
const ALL_ENTITIES = Object.values(modules)
  .flatMap((m) => Object.values(m))
  .filter((v): v is new () => unknown => typeof v === 'function');

const CUSTOMERS = 20;

describe.skipIf(!enabled)('Chống Overbooking trên MySQL thật', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let bookings: CustomerBookingsService;
  let expiry: BookingExpiryService;

  let customers: AuthUser[];
  let roomId: string;
  let d0: string;
  let d1: string;
  let d2: string;
  let d3: string;

  const book = (user: AuthUser, checkIn: string, checkOut: string) =>
    bookings.createBooking(user, {
      room_id: roomId,
      check_in_date: checkIn,
      check_out_date: checkOut,
      num_guests: 2,
    });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'mysql',
          host: process.env.IT_DB_HOST ?? '127.0.0.1',
          port: Number(process.env.IT_DB_PORT),
          username: process.env.IT_DB_USER ?? 'root',
          password: process.env.IT_DB_PASSWORD ?? '',
          database: dbName,
          entities: ALL_ENTITIES,
          extra: { connectionLimit: 40 },
        }),
        TypeOrmModule.forFeature([Booking, Room, PriceCalendar]),
      ],
      providers: [CustomerBookingsService, BookingExpiryService],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    bookings = moduleRef.get(CustomerBookingsService);
    expiry = moduleRef.get(BookingExpiryService);
  }, 60_000);

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await dataSource.synchronize(true); // xóa sạch rồi tạo lại schema

    const userRepo = dataSource.getRepository(User);
    const host = await userRepo.save(
      userRepo.create({ email: 'host@it.vn', password_hash: 'x', full_name: 'Host' }),
    );
    const saved = await userRepo.save(
      Array.from({ length: CUSTOMERS }, (_, i) =>
        userRepo.create({ email: `c${i}@it.vn`, password_hash: 'x', full_name: `Khách ${i}` }),
      ),
    );
    customers = saved.map((u) => ({
      id: u.id,
      email: u.email,
      roles: ['CUSTOMER'],
      session_id: '1',
    }));

    const homestay = await dataSource.getRepository(Homestay).save(
      dataSource.getRepository(Homestay).create({
        host_id: host.id,
        name: 'Villa IT',
        address: '1 Test',
        city: 'Đà Lạt',
        latitude: 11.94,
        longitude: 108.44,
        is_claimed: 1,
      }),
    );
    const room = await dataSource.getRepository(Room).save(
      dataSource.getRepository(Room).create({
        homestay_id: homestay.id,
        room_name: 'Phòng cuối cùng',
        capacity: 2,
        base_price: 900000,
      }),
    );
    roomId = room.id;

    d0 = addDays(todayVn(), 1);
    d1 = addDays(d0, 1);
    d2 = addDays(d0, 2);
    d3 = addDays(d0, 3);
    const calRepo = dataSource.getRepository(PriceCalendar);
    await calRepo.save(
      [d0, d1, d2].map((date, i) =>
        calRepo.create({ room_id: roomId, date, price: 900000 + i * 100000, is_available: 1 }),
      ),
    );
  });

  const calendarState = () =>
    dataSource.getRepository(PriceCalendar).find({ where: { room_id: roomId }, order: { date: 'ASC' } });

  it('AT-07: 20 khách cùng đặt 1 phòng cuối → đúng 1 đơn được tạo, 19 nhận 409', async () => {
    const results = await Promise.allSettled(customers.map((u) => book(u, d0, d3)));

    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(CUSTOMERS - 1);
    expect(rejected.every((r) => r.reason instanceof ConflictException)).toBe(true);

    expect(await dataSource.getRepository(Booking).count()).toBe(1);
    const rows = await calendarState();
    expect(rows.every((r) => r.is_available === 0 && r.locked_until !== null)).toBe(true);
  }, 60_000);

  it('đặt chồng một phần: [d0,d2) và [d1,d3) cùng lúc chỉ 1 đơn thắng (trùng đêm d1)', async () => {
    const results = await Promise.allSettled([
      book(customers[0], d0, d2),
      book(customers[1], d1, d3),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await dataSource.getRepository(Booking).count()).toBe(1);
  }, 60_000);

  it('hai đơn không chồng nhau [d0,d1) và [d1,d3) đều thành công, không deadlock', async () => {
    const results = await Promise.allSettled([
      book(customers[0], d0, d1),
      book(customers[1], d1, d3),
    ]);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await dataSource.getRepository(Booking).count()).toBe(2);
  }, 60_000);

  it('Zero-Trust: tổng tiền = Σ giá từng đêm trong price_calendars', async () => {
    const created = await book(customers[0], d0, d3);

    expect(created.total_amount).toBe(900000 + 1000000 + 1100000);
    const stored = await dataSource.getRepository(Booking).findOneByOrFail({ id: created.id });
    expect(Number(stored.total_amount)).toBe(3000000);
    expect(stored.status).toBe(BookingStatus.PENDING_PAYMENT);
  });

  it('hết hạn 15 phút: đơn EXPIRED, lịch mở lại, ngày Host chủ động khóa vẫn bị khóa', async () => {
    const created = await book(customers[0], d0, d2); // giữ d0, d1
    // Host chủ động khóa d2 (is_available = 0, KHÔNG có locked_until)
    await dataSource.getRepository(PriceCalendar).update({ room_id: roomId, date: d2 }, { is_available: 0 });

    // Chưa quá hạn thì job không đụng vào
    expect(await expiry.expireOverdueBookings()).toBe(0);

    await dataSource
      .getRepository(Booking)
      .update({ id: created.id }, { expires_at: new Date(Date.now() - 60_000) });
    expect(await expiry.expireOverdueBookings()).toBe(1);

    const booking = await dataSource.getRepository(Booking).findOneByOrFail({ id: created.id });
    expect(booking.status).toBe(BookingStatus.EXPIRED);
    const rows = await calendarState();
    expect(rows.map((r) => r.is_available)).toEqual([1, 1, 0]);
    expect(rows[0].locked_until).toBeNull();

    // Chạy lại job là idempotent
    expect(await expiry.expireOverdueBookings()).toBe(0);
    // Phòng đã mở lại nên người khác đặt được
    await expect(book(customers[1], d0, d2)).resolves.toBeDefined();
  }, 60_000);

  it('IPN thắng cuộc đua: đơn đã PAID_ESCROW thì job hết hạn không động vào', async () => {
    const created = await book(customers[0], d0, d1);
    await dataSource.getRepository(Booking).update(
      { id: created.id },
      { status: BookingStatus.PAID_ESCROW, expires_at: new Date(Date.now() - 60_000) },
    );

    expect(await expiry.expireOverdueBookings()).toBe(0);
    const booking = await dataSource.getRepository(Booking).findOneByOrFail({ id: created.id });
    expect(booking.status).toBe(BookingStatus.PAID_ESCROW);
    expect((await calendarState())[0].is_available).toBe(0);
  });
});
