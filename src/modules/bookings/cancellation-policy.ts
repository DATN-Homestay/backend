import { CancellationPolicy } from '../homestays/entities/homestay.entity.js';

const HOUR_MS = 60 * 60 * 1000;
/** Giờ nhận phòng mặc định 14:00 giờ Việt Nam (UTC+7) */
const CHECK_IN_HOUR = '14:00';
/** Host tự hủy đơn bị phạt 20% giá trị đơn, trừ vào Payout kỳ sau (BR-021) */
export const HOST_CANCEL_PENALTY_RATE = 0.2;

export interface RefundCalculation {
  policy: CancellationPolicy;
  /** Số giờ còn lại đến giờ nhận phòng, âm nếu đã quá giờ */
  hoursBeforeCheckIn: number;
  /** Tỷ lệ hoàn tính trên GIÁ TRỊ ĐƠN theo chính sách, 0–100 */
  refundablePercent: number;
  /** Số tiền khách được hoàn */
  refundAmount: number;
  /** Số tiền sàn giữ lại cho Host (đã thanh toán trừ phần hoàn) */
  retainedAmount: number;
  /** Diễn giải quy tắc đã áp dụng, hiển thị cho khách */
  rule: string;
}

/** Thời điểm nhận phòng: ngày check-in lúc 14:00 giờ Việt Nam */
export function checkInMoment(checkInDate: string): Date {
  return new Date(`${checkInDate}T${CHECK_IN_HOUR}:00+07:00`);
}

export function hoursUntilCheckIn(checkInDate: string, now: Date): number {
  return (checkInMoment(checkInDate).getTime() - now.getTime()) / HOUR_MS;
}

interface CalculateInput {
  policy: CancellationPolicy;
  /** Giá trị đơn (total_amount) */
  totalAmount: number;
  nights: number;
  /** Số tiền khách thực sự đã trả qua VNPay */
  paidAmount: number;
  checkInDate: string;
  now: Date;
}

/**
 * Hoàn tiền khi KHÁCH hủy đơn đã thanh toán (FLOW-11, BR-021). Tiền tính theo số nguyên VND.
 *
 *  FLEXIBLE       : trước 24h → 100%; sau đó → hoàn trừ tiền đêm đầu
 *  MODERATE       : trước 5 ngày → 100%; sau đó → 50%
 *  STRICT         : trước 14 ngày → 100%; 7–14 ngày → 50%; dưới 7 ngày → 0%
 *  NON_REFUNDABLE : 0%
 *
 * Tiền đêm đầu lấy trung bình giá đơn / số đêm vì đơn không lưu giá từng đêm.
 */
export function calculateRefund(input: CalculateInput): RefundCalculation {
  const { policy, totalAmount, nights, paidAmount, checkInDate, now } = input;
  const hours = hoursUntilCheckIn(checkInDate, now);

  let refundable: number;
  let rule: string;

  switch (policy) {
    case CancellationPolicy.FLEXIBLE:
      if (hours >= 24) {
        refundable = totalAmount;
        rule = 'Chính sách Linh hoạt: hủy trước 24 giờ được hoàn 100%.';
      } else {
        refundable = Math.max(0, totalAmount - Math.round(totalAmount / Math.max(nights, 1)));
        rule = 'Chính sách Linh hoạt: hủy trong vòng 24 giờ được hoàn lại trừ tiền đêm đầu tiên.';
      }
      break;
    case CancellationPolicy.MODERATE:
      if (hours >= 5 * 24) {
        refundable = totalAmount;
        rule = 'Chính sách Tiêu chuẩn: hủy trước 5 ngày được hoàn 100%.';
      } else {
        refundable = Math.round(totalAmount * 0.5);
        rule = 'Chính sách Tiêu chuẩn: hủy trong vòng 5 ngày được hoàn 50%.';
      }
      break;
    case CancellationPolicy.STRICT:
      if (hours >= 14 * 24) {
        refundable = totalAmount;
        rule = 'Chính sách Nghiêm ngặt: hủy trước 14 ngày được hoàn 100%.';
      } else if (hours >= 7 * 24) {
        refundable = Math.round(totalAmount * 0.5);
        rule = 'Chính sách Nghiêm ngặt: hủy từ 7 đến 14 ngày trước được hoàn 50%.';
      } else {
        refundable = 0;
        rule = 'Chính sách Nghiêm ngặt: hủy trong vòng 7 ngày không được hoàn tiền.';
      }
      break;
    default:
      refundable = 0;
      rule = 'Chính sách Không hoàn tiền: đơn này không được hoàn khi hủy.';
  }

  // Không bao giờ hoàn nhiều hơn số tiền khách thực trả
  const refundAmount = Math.max(0, Math.min(refundable, paidAmount));
  return {
    policy,
    hoursBeforeCheckIn: Math.round(hours * 10) / 10,
    refundablePercent: totalAmount > 0 ? Math.round((refundAmount / totalAmount) * 10000) / 100 : 0,
    refundAmount,
    retainedAmount: Math.max(0, paidAmount - refundAmount),
    rule,
  };
}

/** Host/Admin hủy đơn: hoàn 100% số tiền đã trả; Host chịu phạt 20% giá trị đơn */
export function calculateHostCancel(totalAmount: number, paidAmount: number) {
  return {
    refundAmount: Math.max(0, paidAmount),
    penaltyAmount: Math.round(totalAmount * HOST_CANCEL_PENALTY_RATE),
  };
}
