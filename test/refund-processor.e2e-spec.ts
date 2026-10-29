import * as crypto from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { CancellationService } from '../src/modules/bookings/cancellation.service.js';
import { MAX_REFUND_ATTEMPTS, RefundProcessorService } from '../src/modules/bookings/refund-processor.service.js';
import { CustomerBookingsService } from '../src/modules/bookings/customer-bookings.service.js';
import { CustomerPaymentsService } from '../src/modules/payments/customer-payments.service.js';
import { B2bDemandFulfillmentService } from '../src/modules/bookings/b2b-demand-fulfillment.service.js';
import { Booking } from '../src/modules/bookings/entities/booking.entity.js';
import { EscrowHold } from '../src/modules/bookings/entities/escrow-hold.entity.js';
import { RefundStatus, RefundTransaction } from '../src/modules/bookings/entities/refund-transaction.entity.js';
import { PaymentTransaction } from '../src/modules/payments/entities/payment-transaction.entity.js';
import { Room } from '../src/modules/homestays/entities/room.entity.js';
import { Homestay, CancellationPolicy } from '../src/modules/homestays/entities/homestay.entity.js';
import { PriceCalendar } from '../src/modules/homestays/entities/price-calendar.entity.js';
import { addDays, todayVn } from '../src/modules/bookings/booking.utils.js';
import { signParams, type VnpParams } from '../src/modules/payments/vnpay.helper.js';
import { itEnabled, seedRoom, typeOrmOptions, type SeededRoom } from './helpers/integration-db.js';

/**
 * Bộ xử lý hoàn tiền qua VNPay Refund API trên MySQL THẬT. VNPay được giả lập bằng fetch giả:
 * phản hồi được ký đúng theo thứ tự trường trong tài liệu VNPay, như máy chủ VNPay thật.
 */
const TMN_CODE = 'TESTTMN1';
const SECRET = 'TEST_HASH_SECRET_0123456789abcdef';
const REFUND_URL = 'http://refund.test/api/transaction';

const RESPONSE_FIELDS = [
  'vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef',
  'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType',
  'vnp_TransactionStatus', 'vnp_OrderInfo',
];

/** Phản hồi giả của VNPay; code '00' có chữ ký hợp lệ, các mã lỗi như thực tế không có chữ ký */
function vnpResponse(code: string, extra: Record<string, string> = {}, opts: { badSignature?: boolean } = {}) {
  const body: Record<string, string> = {
    vnp_ResponseId: 'RES1', vnp_Command: 'refund', vnp_ResponseCode: code, vnp_Message: code === '00' ? 'Refund Success' : 'Error',
    vnp_TmnCode: TMN_CODE, vnp_TransactionNo: '14500777', vnp_TransactionStatus: '05', ...extra,
  };
  if (code === '00' || code === '94') {
    const data = RESPONSE_FIELDS.map((k) => body[k] ?? '').join('|');
    const secret = opts.badSignature ? 'SECRET_GIA' : SECRET;
    body.vnp_SecureHash = crypto.createHmac('sha512', secret).update(data, 'utf-8').digest('hex');
  }
  return { ok: true, status: 200, json: async () => body };
}

/** Kiểm tra chữ ký của request mà service đã gửi lên VNPay */
function requestSignatureValid(body: Record<string, string>): boolean {
  const data = [
    'vnp_RequestId', 'vnp_Version', 'vnp_Command', 'vnp_TmnCode', 'vnp_TransactionType', 'vnp_TxnRef',
    'vnp_Amount', 'vnp_TransactionNo', 'vnp_TransactionDate', 'vnp_CreateBy', 'vnp_CreateDate',
    'vnp_IpAddr', 'vnp_OrderInfo',
  ].map((k) => body[k] ?? '').join('|');
  return crypto.createHmac('sha512', SECRET).update(data, 'utf-8').digest('hex') === body.vnp_SecureHash;
}

describe.skipIf(!itEnabled)('Xử lý hoàn tiền qua VNPay trên MySQL thật', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let bookings: CustomerBookingsService;
  let payments: CustomerPaymentsService;
  let cancellation: CancellationService;
  let processor: RefundProcessorService;
  let seed: SeededRoom;
  let fetchMock: ReturnType<typeof vi.fn>;

  const env: Record<string, string> = { VNP_TMN_CODE: TMN_CODE, VNP_HASH_SECRET: SECRET, VNP_REFUND_URL: REFUND_URL };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(typeOrmOptions()),
        TypeOrmModule.forFeature([Booking, PaymentTransaction, Room, Homestay, PriceCalendar, EscrowHold, RefundTransaction]),
      ],
      providers: [
        CancellationService,
        RefundProcessorService,
        CustomerBookingsService,
        CustomerPaymentsService,
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
    seed = await seedRoom(dataSource, { customers: 4 });
    const calRepo = dataSource.getRepository(PriceCalendar);
    const rows = [];
    for (let n = 4; n <= 40; n++) {
      rows.push(calRepo.create({ room_id: seed.roomId, date: addDays(todayVn(), n), price: 1_000_000, is_available: 1 }));
    }
    await calRepo.save(rows);

    vi.spyOn(processor, 'processInBackground').mockImplementation(() => {});
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---------- helpers ----------

  const ipnQuery = (payment: PaymentTransaction) => {
    const params: VnpParams = {
      vnp_Amount: Number(payment.amount) * 100, vnp_BankCode: 'NCB', vnp_PayDate: '20261019153005',
      vnp_ResponseCode: '00', vnp_TmnCode: TMN_CODE, vnp_TransactionNo: '14500001',
      vnp_TransactionStatus: '00', vnp_TxnRef: payment.vnp_txn_ref!,
    };
    const signed = { ...params, vnp_SecureHash: signParams(params, SECRET) };
    return Object.fromEntries(Object.entries(signed).map(([k, v]) => [k, String(v)])) as Record<string, string>;
  };

  /**
   * Tạo một yêu cầu hoàn tiền PENDING thật: đặt phòng → thanh toán (IPN) → khách hủy.
   * FLEXIBLE + hủy sớm → hoàn 2.000.000đ (toàn phần); MODERATE + hủy trong 5 ngày → 1.000.000đ (một phần).
   */
  async function makeRefund(kind: 'full' | 'partial' = 'full', userIdx = 0): Promise<RefundTransaction> {
    const user = seed.customers[userIdx];
    const policy = kind === 'full' ? CancellationPolicy.FLEXIBLE : CancellationPolicy.MODERATE;
    await dataSource.createQueryBuilder().update(Homestay).set({ cancellation_policy: policy }).execute();
    const offset = kind === 'full' ? 10 + userIdx * 3 : 4;
    const booking = await bookings.createBooking(user, {
      room_id: seed.roomId,
      check_in_date: addDays(todayVn(), offset),
      check_out_date: addDays(todayVn(), offset + 2),
      num_guests: 2,
    });
    const link = await payments.createPaymentUrl(user, booking.id, '127.0.0.1');
    const payment = await dataSource.getRepository(PaymentTransaction).findOneByOrFail({ id: link.payment_id });
    await payments.handleIpn(ipnQuery(payment));
    await cancellation.cancelByCustomer(user, booking.id, { reason: 'Thay đổi kế hoạch công tác' });
    return dataSource.getRepository(RefundTransaction).findOneByOrFail({ booking_id: booking.id });
  }

  const reload = (id: string) => dataSource.getRepository(RefundTransaction).findOneByOrFail({ id });
  const sentBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body) as Record<string, string>;

  // ---------- thành công ----------

  it('hoàn TOÀN PHẦN: gửi đúng loại 02, số tiền ×100, giao dịch gốc, chữ ký hợp lệ → PROCESSED', async () => {
    const refund = await makeRefund('full');
    fetchMock.mockResolvedValue(vnpResponse('00'));

    const done = await processor.processRefund(refund.id);

    expect(done).toMatchObject({ status: RefundStatus.PROCESSED, vnp_transaction_no: '14500777', attempts: 1 });
    expect(done?.processed_at).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(REFUND_URL);
    const body = sentBody();
    const payment = await dataSource.getRepository(PaymentTransaction).findOneByOrFail({ id: refund.payment_id! });
    expect(body).toMatchObject({
      vnp_Command: 'refund', vnp_TransactionType: '02', vnp_Amount: '200000000',
      vnp_TxnRef: payment.vnp_txn_ref, vnp_TransactionDate: '20261019153005', vnp_TmnCode: TMN_CODE,
    });
    expect(requestSignatureValid(body)).toBe(true);
    expect(body.vnp_RequestId).toBe(`RF${refund.id}A1`);
  });

  it('hoàn MỘT PHẦN: gửi loại 03 với đúng số tiền hoàn', async () => {
    const refund = await makeRefund('partial');
    fetchMock.mockResolvedValue(vnpResponse('00'));

    await processor.processRefund(refund.id);

    expect(sentBody()).toMatchObject({ vnp_TransactionType: '03', vnp_Amount: '100000000' });
    expect((await reload(refund.id)).status).toBe(RefundStatus.PROCESSED);
  });

  it('mã 94 (VNPay đã nhận yêu cầu trước đó) → coi là đã hoàn, ghi chú lại', async () => {
    const refund = await makeRefund();
    fetchMock.mockResolvedValue(vnpResponse('94'));

    const done = await processor.processRefund(refund.id);

    expect(done?.status).toBe(RefundStatus.PROCESSED);
    expect(done?.last_error).toContain('đã nhận yêu cầu hoàn tiền');
  });

  // ---------- lỗi & thử lại ----------

  it('mã 99: tự thử lại, đủ 3 lần thì FAILED và không bị xử lý nữa', async () => {
    const refund = await makeRefund();
    fetchMock.mockResolvedValue(vnpResponse('99'));

    const first = await processor.processRefund(refund.id);
    expect(first).toMatchObject({ status: RefundStatus.PENDING, attempts: 1 });
    expect(first?.last_error).toContain('99');

    await processor.processRefund(refund.id);
    const third = await processor.processRefund(refund.id);
    expect(third).toMatchObject({ status: RefundStatus.FAILED, attempts: MAX_REFUND_ATTEMPTS });

    // Đã FAILED: không ai nhận lại nữa
    expect(await processor.processRefund(refund.id)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REFUND_ATTEMPTS);
    // Mỗi lần gọi dùng một requestId khác nhau
    expect(new Set(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).vnp_RequestId)).size).toBe(3);
  });

  it('lỗi mạng hoặc HTTP 500: giữ PENDING để thử lại, ghi rõ lý do', async () => {
    const a = await makeRefund('full', 0);
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    expect(await processor.processRefund(a.id)).toMatchObject({ status: RefundStatus.PENDING, attempts: 1 });
    expect((await reload(a.id)).last_error).toContain('Không gọi được VNPay');

    const b = await makeRefund('full', 1);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    expect(await processor.processRefund(b.id)).toMatchObject({ status: RefundStatus.PENDING });
    expect((await reload(b.id)).last_error).toContain('HTTP 500');
  });

  it('mã 91 (không thấy giao dịch) là lỗi dứt khoát: FAILED ngay, không thử lại', async () => {
    const refund = await makeRefund();
    fetchMock.mockResolvedValue(vnpResponse('91'));

    const done = await processor.processRefund(refund.id);

    expect(done).toMatchObject({ status: RefundStatus.FAILED, attempts: 1 });
    expect(done?.last_error).toContain('91');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mã 00 nhưng chữ ký phản hồi sai → KHÔNG tin, chuyển FAILED để Admin đối chiếu', async () => {
    const refund = await makeRefund();
    fetchMock.mockResolvedValue(vnpResponse('00', {}, { badSignature: true }));

    const done = await processor.processRefund(refund.id);

    expect(done?.status).toBe(RefundStatus.FAILED);
    expect(done?.last_error).toContain('Chữ ký phản hồi');
    expect(done?.processed_at).toBeNull();
  });

  it('thiếu thông tin giao dịch gốc (vnp_pay_date) → FAILED ngay, không gọi VNPay', async () => {
    const refund = await makeRefund();
    await dataSource.getRepository(PaymentTransaction).update({ id: refund.payment_id! }, { vnp_pay_date: null });

    const done = await processor.processRefund(refund.id);

    expect(done?.status).toBe(RefundStatus.FAILED);
    expect(done?.last_error).toContain('hoàn tiền thủ công');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ---------- đồng thời & tự phục hồi ----------

  it('5 tiến trình cùng xử lý một yêu cầu → chỉ gọi VNPay đúng 1 lần (không hoàn tiền trùng)', async () => {
    const refund = await makeRefund();
    fetchMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return vnpResponse('00');
    });

    const results = await Promise.all(Array.from({ length: 5 }, () => processor.processRefund(refund.id)));

    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await reload(refund.id)).status).toBe(RefundStatus.PROCESSED);
  }, 60_000);

  it('processPending xử lý các yêu cầu đang chờ và bỏ qua yêu cầu đã hết lượt thử', async () => {
    const a = await makeRefund('full', 0);
    const b = await makeRefund('full', 1);
    await dataSource.getRepository(RefundTransaction).update({ id: b.id }, { attempts: MAX_REFUND_ATTEMPTS });
    fetchMock.mockResolvedValue(vnpResponse('00'));

    const processed = await processor.processPending();

    expect(processed).toBe(1);
    expect((await reload(a.id)).status).toBe(RefundStatus.PROCESSED);
    expect((await reload(b.id)).status).toBe(RefundStatus.PENDING);
  });

  it('yêu cầu kẹt ở PROCESSING quá 10 phút → FAILED, KHÔNG tự thử lại (VNPay có thể đã hoàn)', async () => {
    const refund = await makeRefund();
    await dataSource.getRepository(RefundTransaction).update({ id: refund.id }, { status: RefundStatus.PROCESSING });
    await dataSource.query('UPDATE refund_transactions SET updated_at = NOW() - INTERVAL 30 MINUTE WHERE id = ?', [refund.id]);

    expect(await processor.recoverStuck()).toBe(1);

    const stuck = await reload(refund.id);
    expect(stuck.status).toBe(RefundStatus.FAILED);
    expect(stuck.last_error).toContain('Admin');
    expect(await processor.processPending()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('yêu cầu mới vào PROCESSING (chưa quá 10 phút) thì không bị coi là kẹt', async () => {
    const refund = await makeRefund();
    await dataSource.getRepository(RefundTransaction).update({ id: refund.id }, { status: RefundStatus.PROCESSING });

    expect(await processor.recoverStuck()).toBe(0);
    expect((await reload(refund.id)).status).toBe(RefundStatus.PROCESSING);
  });

  // ---------- Admin ----------

  it('Admin thử lại yêu cầu FAILED: về PENDING, đặt lại số lần thử rồi xử lý ngay', async () => {
    const refund = await makeRefund();
    await dataSource.getRepository(RefundTransaction).update({ id: refund.id }, { status: RefundStatus.FAILED, attempts: 3, last_error: 'VNPay 99' });
    fetchMock.mockResolvedValue(vnpResponse('00'));

    const view = await processor.retry(refund.id);

    expect(view).toMatchObject({ status: RefundStatus.PROCESSED, attempts: 1 });
    expect(view.last_error).toBeNull();
  });

  it('Admin chỉ thử lại được yêu cầu FAILED; không tồn tại thì 404', async () => {
    const refund = await makeRefund();
    await expect(processor.retry(refund.id)).rejects.toThrow(BadRequestException); // đang PENDING
    await expect(processor.retry('999999')).rejects.toThrow(NotFoundException);
  });

  it('Admin đánh dấu đã hoàn thủ công: PROCESSED kèm ghi chú; đánh dấu lần 2 bị từ chối', async () => {
    const refund = await makeRefund();
    await dataSource.getRepository(RefundTransaction).update({ id: refund.id }, { status: RefundStatus.FAILED });

    const view = await processor.markManual(refund.id, '1', 'Chuyển khoản MB FT26102912345');

    expect(view.status).toBe(RefundStatus.PROCESSED);
    const stored = await reload(refund.id);
    expect(stored.gateway_payload).toMatchObject({ manual: true, by_admin_id: '1', note: 'Chuyển khoản MB FT26102912345' });
    await expect(processor.markManual(refund.id, '1', 'Đánh dấu lần nữa')).rejects.toThrow(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('listForAdmin lọc theo trạng thái và kèm mã đơn', async () => {
    const a = await makeRefund('full', 0);
    const b = await makeRefund('full', 1);
    await dataSource.getRepository(RefundTransaction).update({ id: b.id }, { status: RefundStatus.FAILED, last_error: 'VNPay 91' });

    const failed = await processor.listForAdmin(RefundStatus.FAILED, 1, 20);
    const all = await processor.listForAdmin(undefined, 1, 20);

    expect(failed.items.map((r) => r.id)).toEqual([b.id]);
    expect(failed.items[0]).toMatchObject({ status: 'FAILED', last_error: 'VNPay 91', refund_amount: 2_000_000 });
    expect(failed.items[0].booking_code).toMatch(/^BK/);
    expect(all.meta.total).toBe(2);
    expect(a.id).not.toBe(b.id);
  });
});
