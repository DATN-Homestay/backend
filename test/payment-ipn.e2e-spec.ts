import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GoneException, NotFoundException } from '@nestjs/common';

import { B2bDemandFulfillmentService } from '../src/modules/bookings/b2b-demand-fulfillment.service.js';
import { CustomerPaymentsService } from '../src/modules/payments/customer-payments.service.js';
import { CustomerBookingsService } from '../src/modules/bookings/customer-bookings.service.js';
import {
  PaymentStatus,
  PaymentTransaction,
} from '../src/modules/payments/entities/payment-transaction.entity.js';
import { Booking, BookingStatus } from '../src/modules/bookings/entities/booking.entity.js';
import { EscrowHold } from '../src/modules/bookings/entities/escrow-hold.entity.js';
import { RefundTransaction } from '../src/modules/bookings/entities/refund-transaction.entity.js';
import { Room } from '../src/modules/homestays/entities/room.entity.js';
import { PriceCalendar } from '../src/modules/homestays/entities/price-calendar.entity.js';
import {
  IPN_RESPONSE,
  signParams,
  verifySignature,
  type VnpParams,
} from '../src/modules/payments/vnpay.helper.js';
import { itEnabled, seedRoom, typeOrmOptions, type SeededRoom } from './helpers/integration-db.js';

/**
 * Thanh toán VNPay trên MySQL THẬT (AT-08, AT-09, BR-010, BR-011).
 * Giả lập VNPay: tự ký gói IPN bằng đúng secret, như máy chủ VNPay sẽ làm.
 */
const TMN_CODE = 'TESTTMN1';
const SECRET = 'TEST_HASH_SECRET_0123456789abcdef';

describe.skipIf(!itEnabled)('Thanh toán VNPay trên MySQL thật', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let payments: CustomerPaymentsService;
  let bookings: CustomerBookingsService;
  let seed: SeededRoom;

  const env: Record<string, string> = {
    VNP_TMN_CODE: TMN_CODE,
    VNP_HASH_SECRET: SECRET,
    FRONTEND_URL: 'http://localhost:5173',
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(typeOrmOptions()),
        TypeOrmModule.forFeature([Booking, PaymentTransaction, Room, PriceCalendar, EscrowHold, RefundTransaction]),
      ],
      providers: [
        CustomerPaymentsService,
        CustomerBookingsService,
        // Chỉ được gọi cho đơn dropship; các test này dùng homestay đã có chủ nên không chạm tới
        { provide: B2bDemandFulfillmentService, useValue: { fulfillDropshipBooking: vi.fn().mockResolvedValue(null) } },
        { provide: ConfigService, useValue: { get: (key: string, fallback?: string) => env[key] ?? fallback } },
      ],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    payments = moduleRef.get(CustomerPaymentsService);
    bookings = moduleRef.get(CustomerBookingsService);
  }, 60_000);

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    seed = await seedRoom(dataSource, { customers: 3 });
  });

  // ---------- helpers ----------

  /** Đặt phòng d0 → d3 (3 đêm = 3.000.000đ) rồi lấy URL thanh toán */
  const bookAndGetPayment = async (userIndex = 0) => {
    const user = seed.customers[userIndex];
    const booking = await bookings.createBooking(user, {
      room_id: seed.roomId,
      check_in_date: seed.d0,
      check_out_date: seed.d3,
      num_guests: 2,
    });
    const link = await payments.createPaymentUrl(user, booking.id, '127.0.0.1');
    const payment = await dataSource
      .getRepository(PaymentTransaction)
      .findOneByOrFail({ id: link.payment_id });
    return { user, booking, link, payment };
  };

  /** Gói IPN VNPay gửi về, đã ký đúng; `override` thay đổi TRƯỚC khi ký */
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
    // Express luôn đưa query về dạng chuỗi
    return Object.fromEntries(Object.entries(signed).map(([k, v]) => [k, String(v)])) as Record<string, string>;
  };

  const reload = (booking: { id: string }) =>
    dataSource.getRepository(Booking).findOneByOrFail({ id: booking.id });
  const calendar = () =>
    dataSource.getRepository(PriceCalendar).find({ where: { room_id: seed.roomId }, order: { date: 'ASC' } });

  // ---------- tạo URL ----------

  it('tạo URL: số tiền do server tính, chữ ký hợp lệ, vnp_Amount = tiền × 100', async () => {
    const { link, payment } = await bookAndGetPayment();

    expect(link.amount).toBe(3000000);
    const query = Object.fromEntries(new URL(link.payment_url).searchParams.entries());
    expect(query.vnp_Amount).toBe('300000000');
    expect(query.vnp_TxnRef).toBe(payment.vnp_txn_ref);
    expect(query.vnp_TmnCode).toBe(TMN_CODE);
    expect(verifySignature(query, SECRET)).toBe(true);
  });

  it('tạo URL lần 2 cho cùng đơn: dùng lại giao dịch PENDING, không sinh thêm bản ghi', async () => {
    const { user, booking, link } = await bookAndGetPayment();

    const again = await payments.createPaymentUrl(user, booking.id, '127.0.0.1');

    expect(again.payment_id).toBe(link.payment_id);
    expect(await dataSource.getRepository(PaymentTransaction).count()).toBe(1);
  });

  it('tạo URL: người khác nhận 404; đơn đã hết hạn nhận 410', async () => {
    const { user, booking } = await bookAndGetPayment();

    await expect(
      payments.createPaymentUrl(seed.customers[1], booking.id, '127.0.0.1'),
    ).rejects.toThrow(NotFoundException);

    await dataSource.getRepository(Booking).update({ id: booking.id }, { expires_at: new Date(Date.now() + 5_000) });
    await expect(payments.createPaymentUrl(user, booking.id, '127.0.0.1')).rejects.toThrow(GoneException);
  });

  // ---------- IPN thành công + lũy đẳng ----------

  it('IPN thành công: đơn PAID_ESCROW, tạo Escrow, chốt kín lịch (còn is_available = 0, bỏ locked_until)', async () => {
    const { booking, payment } = await bookAndGetPayment();

    expect(await payments.handleIpn(ipnQuery(payment))).toEqual(IPN_RESPONSE.SUCCESS);

    expect((await reload(booking)).status).toBe(BookingStatus.PAID_ESCROW);
    const stored = await dataSource.getRepository(PaymentTransaction).findOneByOrFail({ id: payment.id });
    expect(stored.status).toBe(PaymentStatus.SUCCESS);
    expect(stored.transaction_code).toBe('14500001');
    expect(stored.vnp_pay_date).toBe('20261019153005');
    expect(stored.ipn_payload).toMatchObject({ vnp_BankCode: 'NCB' });

    const escrow = await dataSource.getRepository(EscrowHold).findOneByOrFail({ booking_id: booking.id });
    expect(Number(escrow.amount)).toBe(3000000);
    expect((await calendar()).every((r) => r.is_available === 0 && r.locked_until === null)).toBe(true);
  });

  it('AT-09: gửi 3 IPN trùng liên tiếp → chỉ lần đầu "00", 2 lần sau "02", tiền chỉ ghi 1 lần', async () => {
    const { booking, payment } = await bookAndGetPayment();
    const query = ipnQuery(payment);

    const responses = [
      await payments.handleIpn(query),
      await payments.handleIpn(query),
      await payments.handleIpn(query),
    ];

    expect(responses).toEqual([IPN_RESPONSE.SUCCESS, IPN_RESPONSE.ALREADY_CONFIRMED, IPN_RESPONSE.ALREADY_CONFIRMED]);
    expect(await dataSource.getRepository(EscrowHold).count({ where: { booking_id: booking.id } })).toBe(1);
  });

  it('IPN trùng bắn ĐỒNG THỜI 8 gói → đúng 1 "00", 7 "02", 1 bản ghi Escrow', async () => {
    const { booking, payment } = await bookAndGetPayment();
    const query = ipnQuery(payment);

    const responses = await Promise.all(Array.from({ length: 8 }, () => payments.handleIpn(query)));

    expect(responses.filter((r) => r.RspCode === '00')).toHaveLength(1);
    expect(responses.filter((r) => r.RspCode === '02')).toHaveLength(7);
    expect(await dataSource.getRepository(EscrowHold).count({ where: { booking_id: booking.id } })).toBe(1);
    expect((await reload(booking)).status).toBe(BookingStatus.PAID_ESCROW);
  });

  // ---------- IPN bị từ chối ----------

  it('AT-08: IPN bị sửa vnp_Amount sau khi ký → 97, đơn không đổi', async () => {
    const { booking, payment } = await bookAndGetPayment();
    const tampered = { ...ipnQuery(payment), vnp_Amount: '1000000' };

    expect(await payments.handleIpn(tampered)).toEqual(IPN_RESPONSE.INVALID_CHECKSUM);
    expect((await reload(booking)).status).toBe(BookingStatus.PENDING_PAYMENT);
  });

  it('IPN ký đúng nhưng số tiền khác đơn → 04, đơn không đổi', async () => {
    const { booking, payment } = await bookAndGetPayment();

    expect(await payments.handleIpn(ipnQuery(payment, { vnp_Amount: 1000000 }))).toEqual(
      IPN_RESPONSE.INVALID_AMOUNT,
    );
    expect((await reload(booking)).status).toBe(BookingStatus.PENDING_PAYMENT);
  });

  it('IPN ký bằng secret khác hoặc sai TmnCode → 97', async () => {
    const { payment } = await bookAndGetPayment();
    const forged = ipnQuery(payment);
    forged.vnp_SecureHash = signParams(
      Object.fromEntries(Object.entries(forged).filter(([k]) => k !== 'vnp_SecureHash')) as VnpParams,
      'ATTACKER_SECRET',
    );

    expect(await payments.handleIpn(forged)).toEqual(IPN_RESPONSE.INVALID_CHECKSUM);
    expect(await payments.handleIpn(ipnQuery(payment, { vnp_TmnCode: 'OTHER' }))).toEqual(
      IPN_RESPONSE.INVALID_CHECKSUM,
    );
  });

  it('IPN với vnp_TxnRef không tồn tại → 01', async () => {
    const { payment } = await bookAndGetPayment();

    expect(await payments.handleIpn(ipnQuery(payment, { vnp_TxnRef: 'KHONG-TON-TAI' }))).toEqual(
      IPN_RESPONSE.ORDER_NOT_FOUND,
    );
  });

  it('thanh toán thất bại (mã 24): payment FAILED, đơn vẫn PENDING_PAYMENT, trả "00" cho VNPay', async () => {
    const { booking, payment } = await bookAndGetPayment();

    expect(
      await payments.handleIpn(ipnQuery(payment, { vnp_ResponseCode: '24', vnp_TransactionStatus: '02' })),
    ).toEqual(IPN_RESPONSE.SUCCESS);

    expect((await reload(booking)).status).toBe(BookingStatus.PENDING_PAYMENT);
    const stored = await dataSource.getRepository(PaymentTransaction).findOneByOrFail({ id: payment.id });
    expect(stored.status).toBe(PaymentStatus.FAILED);
    expect(await dataSource.getRepository(EscrowHold).count()).toBe(0);
  });

  // ---------- IPN đến muộn ----------

  it('IPN đến sau khi đơn EXPIRED nhưng phòng còn trống → vẫn xác nhận bình thường', async () => {
    const { booking, payment } = await bookAndGetPayment();
    await dataSource.getRepository(Booking).update({ id: booking.id }, { status: BookingStatus.EXPIRED });
    await dataSource.getRepository(PriceCalendar).update({ room_id: seed.roomId }, { is_available: 1, locked_until: null });

    expect(await payments.handleIpn(ipnQuery(payment))).toEqual(IPN_RESPONSE.SUCCESS);

    expect((await reload(booking)).status).toBe(BookingStatus.PAID_ESCROW);
    expect((await calendar()).every((r) => r.is_available === 0)).toBe(true);
    expect(await dataSource.getRepository(RefundTransaction).count()).toBe(0);
  });

  it('IPN đến sau khi đơn EXPIRED và phòng đã bị người khác đặt → hủy đơn, hoàn 100%', async () => {
    const { booking, payment } = await bookAndGetPayment(0);
    await dataSource.getRepository(Booking).update({ id: booking.id }, { status: BookingStatus.EXPIRED });
    await dataSource.getRepository(PriceCalendar).update({ room_id: seed.roomId }, { is_available: 1, locked_until: null });
    // Người khác đặt đúng khoảng ngày đó
    await bookings.createBooking(seed.customers[1], {
      room_id: seed.roomId,
      check_in_date: seed.d0,
      check_out_date: seed.d3,
      num_guests: 2,
    });

    expect(await payments.handleIpn(ipnQuery(payment))).toEqual(IPN_RESPONSE.SUCCESS);

    expect((await reload(booking)).status).toBe(BookingStatus.CANCELLED);
    const refund = await dataSource.getRepository(RefundTransaction).findOneByOrFail({ booking_id: booking.id });
    expect(Number(refund.refund_amount)).toBe(3000000);
    expect(refund.reason).toContain('LATE_PAYMENT');
    expect(await dataSource.getRepository(EscrowHold).count({ where: { booking_id: booking.id } })).toBe(0);
  });

  // ---------- Return URL & trạng thái ----------

  it('Return URL chỉ đọc: có mã 00 nhưng chưa có IPN thì DB không đổi', async () => {
    const { booking, payment } = await bookAndGetPayment();

    const redirect = await payments.resolveReturnRedirect(ipnQuery(payment));

    expect(redirect).toBe(`http://localhost:5173/payment-result?status=success&payment_id=${payment.id}`);
    expect((await reload(booking)).status).toBe(BookingStatus.PENDING_PAYMENT);
    const stored = await dataSource.getRepository(PaymentTransaction).findOneByOrFail({ id: payment.id });
    expect(stored.status).toBe(PaymentStatus.PENDING);
  });

  it('Return URL sai chữ ký → status=invalid', async () => {
    const { payment } = await bookAndGetPayment();

    const redirect = await payments.resolveReturnRedirect({ ...ipnQuery(payment), vnp_Amount: '1' });

    expect(redirect).toBe('http://localhost:5173/payment-result?status=invalid&payment_id=');
  });

  it('GET payment: chủ đơn xem được trạng thái thật sau IPN, người khác nhận 404', async () => {
    const { user, payment } = await bookAndGetPayment();
    await payments.handleIpn(ipnQuery(payment));

    const result = await payments.getPayment(user, payment.id);

    expect(result).toMatchObject({ status: 'SUCCESS', booking_status: 'PAID_ESCROW', amount: 3000000 });
    await expect(payments.getPayment(seed.customers[1], payment.id)).rejects.toThrow(NotFoundException);
  });
});
