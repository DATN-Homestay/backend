import type { DataSource } from 'typeorm';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../../src/modules/users/entities/user.entity.js';
import { Homestay } from '../../src/modules/homestays/entities/homestay.entity.js';
import { Room } from '../../src/modules/homestays/entities/room.entity.js';
import { PriceCalendar } from '../../src/modules/homestays/entities/price-calendar.entity.js';
import { addDays, todayVn } from '../../src/modules/bookings/booking.utils.js';
import type { AuthUser } from '../../src/modules/auth/auth.types.js';

/**
 * Hạ tầng cho các bài kiểm thử trên MySQL THẬT.
 *
 * Chạy:  IT_DB_PORT=3317 IT_DB_NAME=stayai_it npm run test:e2e
 * Biến:  IT_DB_HOST (127.0.0.1), IT_DB_PORT, IT_DB_USER (root), IT_DB_PASSWORD (rỗng), IT_DB_NAME
 *
 * AN TOÀN: các test XÓA SẠCH schema của DB đích nên chỉ chạy khi IT_DB_NAME chứa
 * "test", "_it" hoặc "e2e". Không bao giờ trỏ vào DB dùng chung của nhóm.
 */
const dbName = process.env.IT_DB_NAME ?? '';
export const itEnabled = !!process.env.IT_DB_PORT && /(test|_it|e2e)/i.test(dbName);

// Gom mọi entity của dự án (lớp có decorator), bỏ qua enum xuất cùng file
const modules = (import.meta as any).glob('../../src/**/*.entity.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;
const ALL_ENTITIES = Object.values(modules)
  .flatMap((m) => Object.values(m))
  .filter((v): v is new () => unknown => typeof v === 'function');

export function typeOrmOptions(): TypeOrmModuleOptions {
  return {
    type: 'mysql',
    host: process.env.IT_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.IT_DB_PORT),
    username: process.env.IT_DB_USER ?? 'root',
    password: process.env.IT_DB_PASSWORD ?? '',
    database: dbName,
    entities: ALL_ENTITIES,
    extra: { connectionLimit: 40 },
  };
}

export interface SeededRoom {
  customers: AuthUser[];
  hostId: string;
  roomId: string;
  /** d0..d3: ngày mai và 3 ngày kế tiếp; lịch có 3 đêm d0, d1, d2 (giá 900k, 1tr, 1,1tr) */
  d0: string;
  d1: string;
  d2: string;
  d3: string;
}

/** Xóa sạch schema rồi dựng: 1 Host, n khách, 1 homestay, 1 phòng, lịch giá 3 đêm còn trống */
export async function seedRoom(
  dataSource: DataSource,
  options: { customers?: number; isClaimed?: 0 | 1 } = {},
): Promise<SeededRoom> {
  await dataSource.synchronize(true);

  const userRepo = dataSource.getRepository(User);
  const host = await userRepo.save(
    userRepo.create({ email: 'host@it.vn', password_hash: 'x', full_name: 'Host' }),
  );
  const saved = await userRepo.save(
    Array.from({ length: options.customers ?? 20 }, (_, i) =>
      userRepo.create({ email: `c${i}@it.vn`, password_hash: 'x', full_name: `Khách ${i}` }),
    ),
  );

  const homestayRepo = dataSource.getRepository(Homestay);
  const homestay = await homestayRepo.save(
    homestayRepo.create({
      host_id: host.id,
      name: 'Villa IT',
      address: '1 Test',
      city: 'Đà Lạt',
      latitude: 11.94,
      longitude: 108.44,
      is_claimed: options.isClaimed ?? 1,
    }),
  );
  const roomRepo = dataSource.getRepository(Room);
  const room = await roomRepo.save(
    roomRepo.create({
      homestay_id: homestay.id,
      room_name: 'Phòng cuối cùng',
      capacity: 2,
      base_price: 900000,
    }),
  );

  const d0 = addDays(todayVn(), 1);
  const [d1, d2, d3] = [1, 2, 3].map((n) => addDays(d0, n));
  const calRepo = dataSource.getRepository(PriceCalendar);
  await calRepo.save(
    [d0, d1, d2].map((date, i) =>
      calRepo.create({ room_id: room.id, date, price: 900000 + i * 100000, is_available: 1 }),
    ),
  );

  return {
    customers: saved.map((u) => ({ id: u.id, email: u.email, roles: ['CUSTOMER'], session_id: '1' })),
    hostId: host.id,
    roomId: room.id,
    d0,
    d1,
    d2,
    d3,
  };
}
