import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { CancellationService } from '../src/modules/bookings/cancellation.service.js';
import { RefundProcessorService } from '../src/modules/bookings/refund-processor.service.js';
import { CustomerBookingsService } from '../src/modules/bookings/customer-bookings.service.js';
import { B2bDemandFulfillmentService } from '../src/modules/bookings/b2b-demand-fulfillment.service.js';
import { CustomerPaymentsService } from '../src/modules/payments/customer-payments.service.js';
import { Booking, BookingStatus } from '../src/modules/bookings/entities/booking.entity.js';
import { EscrowHold, EscrowStatus } from '../src/modules/bookings/entities/escrow-hold.entity.js';
import {
  RefundSource,
  RefundStatus,
  RefundTransaction,
} from '../src/modules/bookings/entities/refund-transaction.entity.js';
import { PaymentTransaction } from '../src/modules/payments/entities/payment-transaction.entity.js';
import { Room } from '../src/modules/homestays/entities/room.entity.js';
import { Homestay, CancellationPolicy } from '../src/modules/homestays/entities/homestay.entity.js';
import { PriceCalendar } from '../src/modules/homestays/entities/price-calendar.entity.js';
import { addDays, todayVn } from '../src/modules/bookings/booking.utils.js';
import { signParams, type VnpParams } from '../src/modules/payments/vnpay.helper.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { itEnabled, seedRoom, typeOrmOptions, type SeededRoom } from './helpers/integration-db.js';

/**
 * Hủy đơn và hoàn tiền Escrow trên MySQL THẬT (FLOW-11, BR-021).
 * Đơn "đã thanh toán" được tạo qua đúng luồng IPN như production (tự ký gói IPN).
 */
const TMN_CODE = 'TESTTMN1';
const SECRET = 'TEST_HASH_SECRET_0123456789abcdef';
const NIGHT_PRICE = 1_000_000;

describe.skipIf(!itEnabled)('Hủy đơn và hoàn tiền trên MySQL thật', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let bookings: CustomerBookingsService;
  let payments: CustomerPaymentsService;
  let cancellation: CancellationService;
  let processor: RefundProcessorService;
  let seed: SeededRoom;
  let host: AuthUser;

  const env: Record<string, string> = { VNP_TMN_CODE: TMN_CODE, VNP_HASH_SECRET: SECRET };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(typeOrmOptions()),
        TypeOrmModule.forFeature([
          Booking, PaymentTransaction, Room, Homestay, PriceCalendar, EscrowHold, RefundTransaction,
        ]),
      ],
      providers: [
        CancellationService,
        RefundProcessorService,
        CustomerBookingsService,
        CustomerPaymentsService,
                // Chỉ được gọi cho đơn dropship; các test này dùng homestay đã có chủ nên không chạm tới
        { provide: B2bDemandFulfillmentService, useValue: { fulfillDropshipBooking: vi.fn().mockResolvedValue(null) } },
        { provide: ConfigService, useValue: { get: (key: string, fallback?: string) => env[key] ?? fallback } },
      ],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    bookings = moduleRef.get(CustomerBookingsService);
    payments = moduleRef.get(CustomerPaymentsService);
    cancellation = moduleRef.get(CancellationService);
    processor = moduleRef.get(RefundProcessorService);
  }, 60_000);

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    seed = await seedRoom(dataSource, { customers: 12 });
    host = { id: seed.hostId, email: 'host@it.vn', roles: ['CUSTOMER', 'HOST'], session_id: '1' };

    // Lịch giá 40 ngày tới, mỗi đêm 1.000.000đ (seedRoom chỉ tạo 3 đêm)
    const calRepo = dataSource.getRepository(PriceCalendar);
    const rows = [];
    for (let n = 4; n <= 40; n++) {
      rows.push(calRepo.create({ room_id: seed.roomId, date: addDays(todayVn(), n), price: NIGHT_PRICE, is_available: 1 }));
    }
    await calRepo.save(rows);

    // Tránh việc xử lý nền can thiệp vào trạng thái cần kiểm tra; từng test tự bật khi cần
    vi.spyOn(processor, 'processInBackground').mockImplementation(() => {}).mockClear();
  });

  // ---------- helpers ----------

  const setPolicy = (policy: CancellationPolicy) =>
    dataSource.createQueryBuilder().update(Homestay).set({ cancellation_policy: policy }).execute();

  /** Đặt 2 đêm bắt đầu sau `offsetDays` ngày kể từ hôm nay (tổng 2.000.000đ) */
  const book = (user: AuthUser, offsetDays: number) =>
    bookings.createBooking(user, {
      room_id: seed.roomId,
      check_in_date: addDays(todayVn(), offsetDays),
      check_out_date: addDays(todayVn(), offsetDays + 2),
      num_guests: 2,
    });

  const ipnQuery = (payment: PaymentTransaction, override: VnpParams = {}) => {
    const params: VnpParams = {
      vnp_Amount: Number(payment.amount) * 100,
      vnp_BankCode: 'NCB',
      vnp_PayDate: '20261019153005',
      vnp_ResponseCode: '00',
      vnp_TmnCode: TMN_CODE,
      vnp_TransactionNo: '14500001',
      vnp_TransactionStatus: '00',
      vnp_TxnRef: payment.vnp_txn_ref!,
      ...override,
    };
    const signed = { ...params, vnp_SecureHash: signParams(params, SECRET) };
    return Object.fromEntries(Object.entries(signed).map(([k, v]) => [k, String(v)])) as Record<string, string>;
  };

  /** Đặt phòng rồi thanh toán thành công qua IPN: đơn PAID_ESCROW, có Escrow */
  const bookAndPay = async (user: AuthUser, offsetDays: number) => {
    const booking = await book(user, offsetDays);
    const link = await payments.createPaymentUrl(user, booking.id, '127.0.0.1');
    const payment = await dataSource.getRepository(PaymentTransaction).findOneByOrFail({ id: link.payment_id });
    expect(await payments.handleIpn(ipnQuery(payment))).toMatchObject({ RspCode: '00' });
    return { booking, payment };
  };

  const reload = (id: string) => dataSource.getRepository(Booking).findOneByOrFail({ id });
  const refundsOf = (bookingId: string) =>
    dataSource.getRepository(RefundTransaction).find({ where: { booking_id: bookingId } });
  const escrowOf = (bookingId: string) =>
    dataSource.getRepository(EscrowHold).findOneByOrFail({ booking_id: bookingId });
  const nightsOf = (offsetDays: number) =>
    dataSource.getRepository(PriceCalendar).find({
      where: [{ room_id: seed.roomId, date: addDays(todayVn(), offsetDays) }, { room_id: seed.roomId, date: addDays(todayVn(), offsetDays + 1) }],
    });

  const reason = { reason: 'Thay đổi kế hoạch công tác' };

  // ---------- khách hủy đơn chưa thanh toán ----------

  it('hủy đơn CHỜ THANH TOÁN: CANCELLED, không hoàn tiền, phòng mở lại cho người khác đặt', async () => {
    const booking = await book(seed.customers[0], 10);

    const result = await cancellation.cancelByCustomer(seed.customers[0], booking.id, reason);

    expect(result).toMatchObject({ status: 'CANCELLED', refund: null });
    const stored = await reload(booking.id);
    expect(stored.status).toBe(BookingStatus.CANCELLED);
    expect(stored.cancelled_by).toBe('CUSTOMER');
    expect(stored.cancel_reason).toBe(reason.reason);
    expect(await refundsOf(booking.id)).toHaveLength(0);
    expect((await nightsOf(10)).every((r) => r.is_available === 1 && r.locked_until === null)).toBe(true);
    await expect(book(seed.customers[1], 10)).resolves.toBeDefined();
  });

  it('bấm hủy lần 2 cho đơn đã hủy → 409', async () => {
    const booking = await book(seed.customers[0], 10);
    await cancellation.cancelByCustomer(seed.customers[0], booking.id, reason);

    await expect(cancellation.cancelByCustomer(seed.customers[0], booking.id, reason)).rejects.toThrow(ConflictException);
  });

  // ---------- khách hủy đơn đã thanh toán, theo từng chính sách ----------

  it('FLEXIBLE, hủy trước ≥24h: hoàn 100%, Escrow REFUNDED, phòng mở lại', async () => {
    await setPolicy(CancellationPolicy.FLEXIBLE);
    const { booking } = await bookAndPay(seed.customers[0], 10);

    const result = await cancellation.cancelByCustomer(seed.customers[0], booking.id, reason);

    expect(result.refund).toMatchObject({ amount: 2_000_000, status: RefundStatus.PENDING });
    const [refund] = await refundsOf(booking.id);
    expect(refund).toMatchObject({ source: RefundSource.CUSTOMER_CANCEL, status: RefundStatus.PENDING });
    expect(Number(refund.refund_amount)).toBe(2_000_000);
    expect(Number(refund.refund_percentage)).toBe(100);
    expect(refund.payment_id).not.toBeNull();
    expect((await reload(booking.id)).status).toBe(BookingStatus.CANCELLED);
    expect((await escrowOf(booking.id)).status).toBe(EscrowStatus.REFUNDED);
    expect((await nightsOf(10)).every((r) => r.is_available === 1)).toBe(true);
    expect(processor.processInBackground).toHaveBeenCalledWith(refund.id);
  });

  it('STRICT, hủy trong vòng 7 ngày: hoàn 0, KHÔNG tạo yêu cầu hoàn, Escrow giữ nguyên cho Host', async () => {
    await setPolicy(CancellationPolicy.STRICT);
    const { booking } = await bookAndPay(seed.customers[0], 5);

    const result = await cancellation.cancelByCustomer(seed.customers[0], booking.id, reason);

    expect(result.refund).toBeNull();
    expect(result.retained_amount).toBe(2_000_000);
    expect(await refundsOf(booking.id)).toHaveLength(0);
    const escrow = await escrowOf(booking.id);
    expect(escrow.status).toBe(EscrowStatus.HOLDING);
    expect(Number(escrow.amount)).toBe(2_000_000);
    expect(processor.processInBackground).not.toHaveBeenCalled();
  });

  it('MODERATE, hủy trong vòng 5 ngày: hoàn 50%, Escrow chỉ còn phần sàn giữ lại', async () => {
    await setPolicy(CancellationPolicy.MODERATE);
    const { booking } = await bookAndPay(seed.customers[0], 4);

    const result = await cancellation.cancelByCustomer(seed.customers[0], booking.id, reason);

    expect(result.refund?.amount).toBe(1_000_000);
    const escrow = await escrowOf(booking.id);
    expect(escrow.status).toBe(EscrowStatus.HOLDING);
    expect(Number(escrow.amount)).toBe(1_000_000);
  });

  it('báo giá hủy khớp với kết quả hủy thật; sai số tiền kỳ vọng thì 409 REFUND_AMOUNT_CHANGED', async () => {
    await setPolicy(CancellationPolicy.MODERATE);
    const { booking } = await bookAndPay(seed.customers[0], 4);

    const quote = await cancellation.quote(seed.customers[0], booking.id);
    expect(quote).toMatchObject({ can_cancel: true, refund_amount: 1_000_000, retained_amount: 1_000_000, paid_amount: 2_000_000 });

    const wrong = cancellation.cancelByCustomer(seed.customers[0], booking.id, { ...reason, expected_refund_amount: 2_000_000 });
    await expect(wrong).rejects.toThrow(ConflictException);
    await wrong.catch((e) => expect(e.getResponse()).toMatchObject({ error_code: 'REFUND_AMOUNT_CHANGED', refund_amount: 1_000_000 }));
    expect((await reload(booking.id)).status).toBe(BookingStatus.PAID_ESCROW);

    const ok = await cancellation.cancelByCustomer(seed.customers[0], booking.id, { ...reason, expected_refund_amount: 1_000_000 });
    expect(ok.refund?.amount).toBe(1_000_000);
  });

  // ---------- đồng thời & quyền ----------

  it('10 yêu cầu hủy ĐỒNG THỜI cùng một đơn → đúng 1 thành công, 9 bị 409, đúng 1 yêu cầu hoàn tiền', async () => {
    await setPolicy(CancellationPolicy.FLEXIBLE);
    const { booking } = await bookAndPay(seed.customers[0], 10);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => cancellation.cancelByCustomer(seed.customers[0], booking.id, reason)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(9);
    expect(rejected.every((r) => r.reason instanceof ConflictException)).toBe(true);
    expect(await refundsOf(booking.id)).toHaveLength(1);
  }, 60_000);

  it('người lạ hủy hoặc xem báo giá đơn của người khác → 404, đơn không đổi', async () => {
    const { booking } = await bookAndPay(seed.customers[0], 10);

    await expect(cancellation.cancelByCustomer(seed.customers[1], booking.id, reason)).rejects.toThrow(NotFoundException);
    await expect(cancellation.quote(seed.customers[1], booking.id)).rejects.toThrow(NotFoundException);
    expect((await reload(booking.id)).status).toBe(BookingStatus.PAID_ESCROW);
  });

  it('đơn đã CHECKED_IN không thể hủy (409); báo giá nói rõ lý do', async () => {
    const { booking } = await bookAndPay(seed.customers[0], 10);
    await dataSource.getRepository(Booking).update({ id: booking.id }, { status: BookingStatus.CHECKED_IN });

    await expect(cancellation.cancelByCustomer(seed.customers[0], booking.id, reason)).rejects.toThrow(ConflictException);
    const quote = await cancellation.quote(seed.customers[0], booking.id);
    expect(quote.can_cancel).toBe(false);
    expect(quote.reason_cannot).toContain('nhận phòng');
  });

  it('đã quá giờ nhận phòng thì không hủy trực tuyến được', async () => {
    const { booking } = await bookAndPay(seed.customers[0], 10);
    // Lùi ngày nhận phòng về hôm qua để mô phỏng "đã quá giờ nhận phòng mà chưa check-in"
    await dataSource.getRepository(Booking).update(
      { id: booking.id },
      { check_in_date: addDays(todayVn(), -1), check_out_date: todayVn() },
    );

    await expect(cancellation.cancelByCustomer(seed.customers[0], booking.id, reason)).rejects.toThrow('quá giờ nhận phòng');
    expect((await cancellation.quote(seed.customers[0], booking.id)).can_cancel).toBe(false);
  });

  // ---------- Host hủy ----------

  it('Host hủy: khách hoàn 100%, Host bị phạt 20%, lịch vẫn bị khóa, Escrow REFUNDED', async () => {
    await setPolicy(CancellationPolicy.STRICT); // chính sách nghiêm ngặt không ảnh hưởng khi Host hủy
    const { booking } = await bookAndPay(seed.customers[0], 5);

    const result = await cancellation.cancelByHost(host, booking.id, { reason: 'Nhà bị sự cố điện nước' });

    expect(result.refund?.amount).toBe(2_000_000);
    const [refund] = await refundsOf(booking.id);
    expect(refund.source).toBe(RefundSource.HOST_CANCEL);
    expect(Number(refund.penalty_amount)).toBe(400_000);
    const stored = await reload(booking.id);
    expect(stored).toMatchObject({ status: BookingStatus.CANCELLED, cancelled_by: 'HOST' });
    expect((await escrowOf(booking.id)).status).toBe(EscrowStatus.REFUNDED);
    // Host không bán lại được lịch vừa hủy
    expect((await nightsOf(5)).every((r) => r.is_available === 0)).toBe(true);
    await expect(book(seed.customers[1], 5)).rejects.toThrow(ConflictException);
  });

  it('chỉ Host của homestay mới hủy được; người khác nhận 404; đơn chưa thanh toán thì 409', async () => {
    const { booking } = await bookAndPay(seed.customers[0], 10);
    const otherHost: AuthUser = { id: seed.customers[5].id, email: 'o@it.vn', roles: ['CUSTOMER', 'HOST'], session_id: '9' };
    await expect(cancellation.cancelByHost(otherHost, booking.id, reason)).rejects.toThrow(NotFoundException);

    const pending = await book(seed.customers[2], 20);
    await expect(cancellation.cancelByHost(host, pending.id, reason)).rejects.toThrow(ConflictException);
  });

  // ---------- IPN đến sau khi khách đã hủy ----------

  it('khách hủy đơn chờ thanh toán rồi IPN thành công đến muộn → tự tạo hoàn tiền 100% (LATE_PAYMENT)', async () => {
    const booking = await book(seed.customers[0], 10);
    const link = await payments.createPaymentUrl(seed.customers[0], booking.id, '127.0.0.1');
    const payment = await dataSource.getRepository(PaymentTransaction).findOneByOrFail({ id: link.payment_id });
    await cancellation.cancelByCustomer(seed.customers[0], booking.id, reason);

    expect(await payments.handleIpn(ipnQuery(payment))).toMatchObject({ RspCode: '00' });

    expect((await reload(booking.id)).status).toBe(BookingStatus.CANCELLED);
    const [refund] = await refundsOf(booking.id);
    expect(refund).toMatchObject({ source: RefundSource.LATE_PAYMENT, status: RefundStatus.PENDING, payment_id: payment.id });
    expect(Number(refund.refund_amount)).toBe(2_000_000);
  });

  // ---------- lịch sử hoàn tiền ----------

  it('listMyRefunds chỉ trả hoàn tiền của chính mình', async () => {
    await setPolicy(CancellationPolicy.FLEXIBLE);
    const a = await bookAndPay(seed.customers[0], 10);
    const b = await bookAndPay(seed.customers[1], 20);
    await cancellation.cancelByCustomer(seed.customers[0], a.booking.id, reason);
    await cancellation.cancelByCustomer(seed.customers[1], b.booking.id, reason);

    const mine = await cancellation.listMyRefunds(seed.customers[0]);

    expect(mine).toHaveLength(1);
    expect(mine[0].booking_code).toBe(a.booking.booking_code);
  });
});
