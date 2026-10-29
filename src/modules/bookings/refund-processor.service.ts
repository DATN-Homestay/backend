import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { RefundStatus, RefundTransaction } from './entities/refund-transaction.entity.js';
import { PaymentStatus, PaymentTransaction } from '../payments/entities/payment-transaction.entity.js';
import { toVnd } from './booking.utils.js';
import { buildRefundRequest, formatVnpDate, verifyRefundResponse } from '../payments/vnpay.helper.js';

export const MAX_REFUND_ATTEMPTS = 3;
const STUCK_MINUTES = 10;
const REQUEST_TIMEOUT_MS = 20_000;
const BATCH_SIZE = 20;
const REFUND_URL = 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';

/** Mã phản hồi của VNPay Refund API (tài liệu truy vấn & hoàn tiền) */
const CODE_SUCCESS = '00';
/** VNPay đã nhận yêu cầu hoàn cho giao dịch này trước đó và đang xử lý */
const CODE_ALREADY_REQUESTED = '94';
/** Lỗi chung phía VNPay: đáng thử lại */
const CODE_UNEXPECTED = '99';

/** Chỉ nhận chuỗi/số từ phản hồi bên ngoài, tránh in ra '[object Object]' */
const asText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/** TypeORM không suy được kiểu của cột JSON trong update(); ép kiểu ở một chỗ duy nhất */
const asJson = (value: Record<string, unknown> | null) => value as never;

type Outcome =
  | { kind: 'success'; payload: Record<string, unknown>; transactionNo: string | null; note?: string }
  | { kind: 'retry'; error: string; payload?: Record<string, unknown> }
  | { kind: 'fail'; error: string; payload?: Record<string, unknown> };

/**
 * Hoàn tiền Escrow về cho khách qua VNPay Refund API (FLOW-11, BR-021).
 * - Chỉ một tiến trình nhận được mỗi yêu cầu (chuyển PENDING -> PROCESSING có điều kiện).
 * - Lỗi mạng hoặc mã 99: tự thử lại tối đa MAX_REFUND_ATTEMPTS lần, sau đó FAILED để Admin xử lý.
 * - Admin có thể thử lại hoặc đánh dấu đã hoàn thủ công (chuyển khoản ngân hàng / Merchant Admin).
 */
@Injectable()
export class RefundProcessorService {
  private readonly logger = new Logger(RefundProcessorService.name);
  private running = false;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(RefundTransaction)
    private readonly refundRepo: Repository<RefundTransaction>,
    @InjectRepository(PaymentTransaction)
    private readonly paymentRepo: Repository<PaymentTransaction>,
  ) {}

  // =========================================================
  // JOB NỀN
  // =========================================================

  @Cron('0 */2 * * * *')
  async handleCron(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.recoverStuck();
      await this.processPending();
    } catch (error) {
      this.logger.error(`Lỗi job hoàn tiền: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** Xử lý ngay sau khi hủy đơn mà không bắt khách chờ cuộc gọi sang VNPay */
  processInBackground(id: string): void {
    setImmediate(() => {
      this.processRefund(id).catch((error) =>
        this.logger.error(`Hoàn tiền #${id} lỗi: ${error instanceof Error ? error.message : String(error)}`),
      );
    });
  }

  async processPending(): Promise<number> {
    const pending = await this.refundRepo.find({
      where: { status: RefundStatus.PENDING },
      order: { id: 'ASC' },
      take: BATCH_SIZE,
    });
    let done = 0;
    for (const refund of pending) {
      if (await this.processRefund(refund.id)) done++;
    }
    return done;
  }

  /**
   * Yêu cầu kẹt ở PROCESSING quá lâu (server tắt giữa chừng): KHÔNG tự thử lại vì VNPay có thể đã
   * hoàn tiền rồi. Chuyển FAILED để Admin đối chiếu với Merchant Admin trước khi quyết định.
   */
  async recoverStuck(now = new Date()): Promise<number> {
    const result = await this.refundRepo.update(
      {
        status: RefundStatus.PROCESSING,
        updated_at: LessThan(new Date(now.getTime() - STUCK_MINUTES * 60_000)),
      },
      {
        status: RefundStatus.FAILED,
        last_error: 'Quá thời gian xử lý, cần Admin đối chiếu với VNPay trước khi thử lại',
      },
    );
    return result.affected ?? 0;
  }

  // =========================================================
  // XỬ LÝ MỘT YÊU CẦU
  // =========================================================

  /** @returns yêu cầu sau khi xử lý, hoặc null nếu đã có tiến trình khác nhận / không còn ở PENDING */
  async processRefund(id: string): Promise<RefundTransaction | null> {
    const claimed = await this.refundRepo
      .createQueryBuilder()
      .update(RefundTransaction)
      .set({ status: RefundStatus.PROCESSING, attempts: () => 'attempts + 1' })
      .where('id = :id AND status = :status AND attempts < :max', {
        id,
        status: RefundStatus.PENDING,
        max: MAX_REFUND_ATTEMPTS,
      })
      .execute();
    if (claimed.affected !== 1) return null;

    const refund = await this.refundRepo.findOneByOrFail({ id });
    const outcome = await this.callGateway(refund);

    if (outcome.kind === 'success') {
      await this.refundRepo.update(
        { id, status: RefundStatus.PROCESSING },
        {
          status: RefundStatus.PROCESSED,
          vnp_transaction_no: outcome.transactionNo,
          gateway_payload: asJson(outcome.payload),
          last_error: outcome.note ?? null,
          processed_at: new Date(),
        },
      );
      this.logger.log(`Hoàn tiền #${id} thành công (${toVnd(refund.refund_amount).toLocaleString('vi-VN')}đ)`);
    } else {
      const giveUp = outcome.kind === 'fail' || refund.attempts >= MAX_REFUND_ATTEMPTS;
      await this.refundRepo.update(
        { id, status: RefundStatus.PROCESSING },
        {
          status: giveUp ? RefundStatus.FAILED : RefundStatus.PENDING,
          last_error: outcome.error.slice(0, 500),
          gateway_payload: asJson(outcome.payload ?? refund.gateway_payload),
        },
      );
      this.logger.warn(`Hoàn tiền #${id} lần ${refund.attempts} chưa thành công: ${outcome.error}`);
    }
    return this.refundRepo.findOneByOrFail({ id });
  }

  private async callGateway(refund: RefundTransaction): Promise<Outcome> {
    const payment = await this.paymentRepo.findOne({
      where: refund.payment_id
        ? { id: refund.payment_id }
        : { booking_id: refund.booking_id, status: PaymentStatus.SUCCESS },
      order: { id: 'DESC' },
    });
    if (!payment || !payment.vnp_txn_ref || !payment.vnp_pay_date) {
      return { kind: 'fail', error: 'Thiếu thông tin giao dịch VNPay gốc, cần hoàn tiền thủ công' };
    }

    const tmnCode = this.configService.get<string>('VNP_TMN_CODE');
    const secret = this.configService.get<string>('VNP_HASH_SECRET');
    if (!tmnCode || !secret) {
      return { kind: 'fail', error: 'Chưa cấu hình VNPay (VNP_TMN_CODE, VNP_HASH_SECRET)' };
    }

    const amount = toVnd(refund.refund_amount);
    const paid = toVnd(payment.amount);
    if (amount <= 0 || amount > paid) {
      return { kind: 'fail', error: 'Số tiền hoàn không hợp lệ so với giao dịch gốc' };
    }

    // Mỗi lần gọi một requestId mới (VNPay yêu cầu duy nhất trong ngày); gọi trùng giao dịch sẽ nhận mã 94
    const requestId = `RF${refund.id}A${refund.attempts}`.slice(0, 32);
    await this.refundRepo.update({ id: refund.id }, { vnp_request_id: requestId });

    const body = buildRefundRequest(
      {
        requestId,
        tmnCode,
        transactionType: amount === paid ? '02' : '03',
        txnRef: payment.vnp_txn_ref,
        amountVnd: amount,
        transactionNo: payment.transaction_code ?? '',
        transactionDate: payment.vnp_pay_date,
        createBy: 'StayAI-System',
        createDate: formatVnpDate(new Date()),
        ipAddr: this.configService.get<string>('SERVER_IP', '127.0.0.1'),
        orderInfo: `Hoan tien don ${refund.booking_id}`.slice(0, 255),
      },
      secret,
    );

    let json: Record<string, unknown>;
    try {
      const response = await fetch(this.configService.get<string>('VNP_REFUND_URL', REFUND_URL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { kind: 'retry', error: `VNPay trả HTTP ${response.status}` };
      }
      json = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      return {
        kind: 'retry',
        error: `Không gọi được VNPay: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const code = asText(json.vnp_ResponseCode);
    const message = asText(json.vnp_Message);

    if (code === CODE_SUCCESS) {
      // Tiền đã rời tài khoản sàn nên chỉ tin phản hồi có chữ ký hợp lệ
      if (!verifyRefundResponse(json, secret)) {
        return {
          kind: 'fail',
          error: 'Chữ ký phản hồi của VNPay không hợp lệ, Admin cần đối chiếu giao dịch trên Merchant Admin',
          payload: json,
        };
      }
      return { kind: 'success', payload: json, transactionNo: asText(json.vnp_TransactionNo) || null };
    }
    if (code === CODE_ALREADY_REQUESTED) {
      return {
        kind: 'success',
        payload: json,
        transactionNo: asText(json.vnp_TransactionNo) || null,
        note: 'VNPay báo đã nhận yêu cầu hoàn tiền cho giao dịch này trước đó',
      };
    }
    if (code === CODE_UNEXPECTED) {
      return { kind: 'retry', error: `VNPay ${code}: ${message}`, payload: json };
    }
    return { kind: 'fail', error: `VNPay ${code}: ${message}`, payload: json };
  }

  // =========================================================
  // ADMIN
  // =========================================================

  async listForAdmin(status: RefundStatus | undefined, page: number, limit: number) {
    const [items, total] = await this.refundRepo.findAndCount({
      where: status ? { status } : {},
      relations: { booking: true },
      order: { id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items: items.map((r) => this.toView(r)),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    };
  }

  /** Thử lại một yêu cầu đã FAILED (VNPay trả mã 94 nếu giao dịch đã được hoàn trước đó) */
  async retry(id: string) {
    const reset = await this.refundRepo.update(
      { id, status: RefundStatus.FAILED },
      { status: RefundStatus.PENDING, attempts: 0, last_error: null },
    );
    if (reset.affected !== 1) {
      await this.assertExists(id);
      throw new BadRequestException('Chỉ thử lại được yêu cầu hoàn tiền đã thất bại');
    }
    await this.processRefund(id);
    return this.loadView(id);
  }

  /** Admin đã hoàn tiền ngoài hệ thống (chuyển khoản tay hoặc trên Merchant Admin) */
  async markManual(id: string, adminId: string, note: string) {
    const result = await this.refundRepo.update(
      { id, status: In([RefundStatus.FAILED, RefundStatus.PENDING]) },
      {
        status: RefundStatus.PROCESSED,
        processed_at: new Date(),
        last_error: null,
        gateway_payload: asJson({ manual: true, by_admin_id: adminId, note, at: new Date().toISOString() }),
      },
    );
    if (result.affected !== 1) {
      await this.assertExists(id);
      throw new BadRequestException('Chỉ đánh dấu hoàn thủ công được yêu cầu đang chờ hoặc đã thất bại');
    }
    return this.loadView(id);
  }

  /** Đọc lại kèm đơn để phản hồi có mã đơn */
  private async loadView(id: string) {
    return this.toView(await this.refundRepo.findOneOrFail({ where: { id }, relations: { booking: true } }));
  }

  private async assertExists(id: string): Promise<void> {
    if (!(await this.refundRepo.exists({ where: { id } }))) {
      throw new NotFoundException('Không tìm thấy yêu cầu hoàn tiền');
    }
  }

  private toView(r: RefundTransaction) {
    return {
      id: r.id,
      booking_id: r.booking_id,
      booking_code: r.booking?.booking_code ?? null,
      source: r.source,
      refund_amount: toVnd(r.refund_amount),
      penalty_amount: toVnd(r.penalty_amount),
      status: r.status,
      attempts: r.attempts,
      reason: r.reason,
      last_error: r.last_error,
      vnp_transaction_no: r.vnp_transaction_no,
      processed_at: r.processed_at,
      created_at: r.created_at,
    };
  }
}
