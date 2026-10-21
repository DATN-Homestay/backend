import * as crypto from 'crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Việt Nam UTC+7, không có giờ mùa hè */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * TypeORM trả cột decimal dạng chuỗi ('900000.00'). Mọi phép tính tiền phải đổi
 * sang số nguyên VND trước, tránh '900000' + '1100000' = '9000001100000'.
 */
export function toVnd(value: number | string | null | undefined): number {
  return Math.round(Number(value ?? 0));
}

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD */
export function todayVn(now = new Date()): string {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Chuỗi YYYY-MM-DD có phải một ngày có thật (loại 2026-02-31) */
export function isRealDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
      DAY_MS,
  );
}

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Danh sách các đêm [checkIn, checkOut): ngày trả phòng không tính là một đêm */
export function listNights(checkIn: string, checkOut: string): string[] {
  const nights = daysBetween(checkIn, checkOut);
  return Array.from({ length: nights }, (_, i) => addDays(checkIn, i));
}

/** Mã đơn hiển thị cho khách, ví dụ BK20261019A1B2C3D4 */
export function generateBookingCode(now = new Date()): string {
  const day = todayVn(now).replaceAll('-', '');
  return `BK${day}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}
