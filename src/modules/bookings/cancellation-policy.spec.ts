import { describe, it, expect } from 'vitest';
import { CancellationPolicy } from '../homestays/entities/homestay.entity.js';
import {
  calculateHostCancel,
  calculateRefund,
  checkInMoment,
  hoursUntilCheckIn,
} from './cancellation-policy.js';

// Đơn mẫu: 3 đêm, 3.000.000đ, nhận phòng 20/11/2026 14:00 (giờ VN)
const CHECK_IN = '2026-11-20';
const TOTAL = 3_000_000;
const NIGHTS = 3;

/** Thời điểm hủy cách giờ nhận phòng `hours` giờ */
const cancelAt = (hours: number) => new Date(checkInMoment(CHECK_IN).getTime() - hours * 3_600_000);

const refund = (policy: CancellationPolicy, hoursBefore: number, paid = TOTAL) =>
  calculateRefund({ policy, totalAmount: TOTAL, nights: NIGHTS, paidAmount: paid, checkInDate: CHECK_IN, now: cancelAt(hoursBefore) });

describe('thời điểm nhận phòng', () => {
  it('14:00 giờ Việt Nam = 07:00 UTC', () => {
    expect(checkInMoment('2026-11-20').toISOString()).toBe('2026-11-20T07:00:00.000Z');
  });

  it('hoursUntilCheckIn: dương trước giờ nhận phòng, âm sau đó', () => {
    expect(hoursUntilCheckIn(CHECK_IN, cancelAt(48))).toBe(48);
    expect(hoursUntilCheckIn(CHECK_IN, cancelAt(-2))).toBe(-2);
  });
});

describe('calculateRefund() - FLEXIBLE', () => {
  it('đúng mốc 24 giờ vẫn được hoàn 100%', () => {
    const r = refund(CancellationPolicy.FLEXIBLE, 24);
    expect(r.refundAmount).toBe(3_000_000);
    expect(r.retainedAmount).toBe(0);
    expect(r.refundablePercent).toBe(100);
  });

  it('sát mốc: 23h59 → hoàn trừ tiền đêm đầu (1.000.000đ)', () => {
    const r = refund(CancellationPolicy.FLEXIBLE, 23.98);
    expect(r.refundAmount).toBe(2_000_000);
    expect(r.retainedAmount).toBe(1_000_000);
  });

  it('đơn 1 đêm hủy muộn: trừ cả đêm đầu nên hoàn 0', () => {
    const r = calculateRefund({
      policy: CancellationPolicy.FLEXIBLE,
      totalAmount: 900_000,
      nights: 1,
      paidAmount: 900_000,
      checkInDate: CHECK_IN,
      now: cancelAt(5),
    });
    expect(r.refundAmount).toBe(0);
    expect(r.retainedAmount).toBe(900_000);
  });
});

describe('calculateRefund() - MODERATE (Tiêu chuẩn)', () => {
  it.each([
    [200, 3_000_000],
    [120, 3_000_000], // đúng mốc 5 ngày
    [119, 1_500_000],
    [1, 1_500_000],
  ])('hủy trước %s giờ → hoàn %s', (hours, expected) => {
    expect(refund(CancellationPolicy.MODERATE, hours).refundAmount).toBe(expected);
  });
});

describe('calculateRefund() - STRICT (Nghiêm ngặt)', () => {
  it.each([
    [400, 3_000_000],
    [336, 3_000_000], // đúng mốc 14 ngày
    [335, 1_500_000],
    [168, 1_500_000], // đúng mốc 7 ngày
    [167, 0],
    [1, 0],
  ])('hủy trước %s giờ → hoàn %s', (hours, expected) => {
    expect(refund(CancellationPolicy.STRICT, hours).refundAmount).toBe(expected);
  });
});

describe('calculateRefund() - NON_REFUNDABLE', () => {
  it('luôn hoàn 0, sàn giữ toàn bộ số đã trả', () => {
    const r = refund(CancellationPolicy.NON_REFUNDABLE, 1000);
    expect(r.refundAmount).toBe(0);
    expect(r.retainedAmount).toBe(3_000_000);
  });
});

describe('calculateRefund() - ràng buộc chung', () => {
  it('không bao giờ hoàn nhiều hơn số tiền khách thực trả', () => {
    const r = refund(CancellationPolicy.FLEXIBLE, 100, 1_000_000);
    expect(r.refundAmount).toBe(1_000_000);
    expect(r.retainedAmount).toBe(0);
  });

  it('trả về diễn giải quy tắc để hiển thị cho khách', () => {
    expect(refund(CancellationPolicy.STRICT, 10).rule).toContain('không được hoàn tiền');
    expect(refund(CancellationPolicy.MODERATE, 500).rule).toContain('100%');
  });

  it('làm tròn số nguyên VND, không sinh số lẻ', () => {
    const r = calculateRefund({
      policy: CancellationPolicy.MODERATE,
      totalAmount: 1_000_001,
      nights: 1,
      paidAmount: 1_000_001,
      checkInDate: CHECK_IN,
      now: cancelAt(10),
    });
    expect(Number.isInteger(r.refundAmount)).toBe(true);
    expect(r.refundAmount + r.retainedAmount).toBe(1_000_001);
  });
});

describe('calculateHostCancel()', () => {
  it('hoàn 100% số đã trả và Host bị phạt 20% giá trị đơn', () => {
    expect(calculateHostCancel(3_000_000, 3_000_000)).toEqual({
      refundAmount: 3_000_000,
      penaltyAmount: 600_000,
    });
  });
});
