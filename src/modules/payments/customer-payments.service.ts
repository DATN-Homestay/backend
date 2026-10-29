import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { PaymentStatus, PaymentTransaction } from './entities/payment-transaction.entity.js';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity.js';
import { EscrowHold, EscrowStatus } from '../bookings/entities/escrow-hold.entity.js';
import {
  RefundSource,
  RefundStatus,
  RefundTransaction,
} from '../bookings/entities/refund-transaction.entity.js';
import { PriceCalendar } from '../homestays/entities/price-calendar.entity.js';
import { listNights, toVnd } from '../bookings/booking.utils.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  IPN_RESPONSE,
  buildPaymentUrl,
  formatVnpDate,
  generateTxnRef,
  verifySignature,
} from './vnpay.helper.js';
import { B2bDemandFulfillmentService } from '../bookings/b2b-demand-fulfillment.service.js';

const SANDBOX_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
/** Link thanh toán cần còn tối thiểu từng này thời gian mới đáng tạo */
const MIN_REMAINING_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type IpnResponse = (typeof IPN_RESPONSE)[keyof typeof IPN_RESPONSE];

/**
 * Customer Payments Service - Thanh toán VNPay (REQ-013, REQ-014, BR-009 → BR-011).
 * Chỉ IPN (server-to-server) được đổi trạng thái tiền; Return URL chỉ để hiển thị.
 */
@Injectable()
export class CustomerPaymentsService {
  private readonly logger = new Logger(CustomerPaymentsService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(PaymentTransaction)
    private readonly paymentRepo: Repository<PaymentTransaction>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly b2bFulfillmentService: B2bDemandFulfillmentService,
  ) {}

  // =========================================================
  // TẠO URL THANH TOÁN
  // =========================================================

  async createPaymentUrl(authUser: AuthUser, bookingId: string, clientIp: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, customer_id: authUser.id },
    });
    if (!booking) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng');
    }
    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      throw new ConflictException('Đơn này không còn ở trạng thái chờ thanh toán');
    }

    const now = new Date();
    if (!booking.expires_at || booking.expires_at.getTime() - now.getTime() < MIN_REMAINING_MS) {
      throw new GoneException('Đơn đã hết thời gian giữ chỗ, vui lòng đặt lại');
    }

    const config = this.vnpConfig();
    // Số tiền lấy từ đơn do server tính (BR-009), không nhận gì từ client
    const amount = toVnd(booking.total_amount);

    // Dùng lại giao dịch đang chờ để khách đóng/mở lại trang không sinh thêm bản ghi
    let payment = await this.paymentRepo.findOne({
      where: { booking_id: booking.id, status: PaymentStatus.PENDING },
      order: { created_at: 'DESC' },
    });
    if (!payment) {
      payment = await this.paymentRepo.save(
        this.paymentRepo.create({
          booking_id: booking.id,
          payment_method: 'VNPAY',
          amount,
          vnp_txn_ref: generateTxnRef(booking.booking_code),
          status: PaymentStatus.PENDING,
          expires_at: booking.expires_at,
        }),
      );
    }

    const paymentUrl = buildPaymentUrl(
      config.url,
      {
        vnp_Version: '2.1.0',
        vnp_Command: 'pay',
        vnp_TmnCode: config.tmnCode,
        vnp_Amount: amount * 100,
        vnp_CurrCode: 'VND',
        vnp_TxnRef: payment.vnp_txn_ref!,
        vnp_OrderInfo: `Thanh toan don ${booking.booking_code}`,
        vnp_OrderType: 'other',
        vnp_Locale: 'vn',
        vnp_ReturnUrl: config.returnUrl,
        vnp_IpAddr: clientIp,
        vnp_CreateDate: formatVnpDate(now),
        vnp_ExpireDate: formatVnpDate(booking.expires_at),
      },
      config.secret,
    );

    return {
      payment_id: payment.id,
      booking_code: booking.booking_code,
      amount,
      payment_deadline: booking.expires_at.toISOString(),
      payment_url: paymentUrl,
    };
  }

  // =========================================================
  // IPN WEBHOOK (nơi duy nhất đổi trạng thái tiền)
  // =========================================================

  async handleIpn(rawQuery: Record<string, unknown>): Promise<IpnResponse> {
    try {
      const query = this.normalizeQuery(rawQuery);
      const config = this.vnpConfig();

      // Bước 1: chữ ký (BR-010)
      if (!verifySignature(query, config.secret) || query.vnp_TmnCode !== config.tmnCode) {
        this.logger.warn(`IPN sai chữ ký, vnp_TxnRef=${query.vnp_TxnRef ?? '?'}`);
        return IPN_RESPONSE.INVALID_CHECKSUM;
      }

      // Bước 2-3: đơn tồn tại và đúng số tiền (so với số đã lưu, không tin tham số)
      const payment = await this.paymentRepo.findOne({
        where: { vnp_txn_ref: query.vnp_TxnRef },
      });
      if (!payment) return IPN_RESPONSE.ORDER_NOT_FOUND;
      if (Number(query.vnp_Amount) !== toVnd(payment.amount) * 100) {
        this.logger.warn(`IPN sai số tiền, vnp_TxnRef=${query.vnp_TxnRef}`);
        return IPN_RESPONSE.INVALID_AMOUNT;
      }

      // Bước 4-6: lũy đẳng + cập nhật trong một transaction (BR-011)
      return await this.dataSource.transaction((em) => this.applyIpn(em, payment.id, query));
    } catch (error) {
      this.logger.error(
        `Lỗi xử lý IPN: ${error instanceof Error ? error.message : String(error)}`,
      );
      return IPN_RESPONSE.UNKNOWN_ERROR;
    }
  }

  private async applyIpn(
    em: EntityManager,
    paymentId: string,
    query: Record<string, string>,
  ): Promise<IpnResponse> {
    // Khóa theo thứ tự payment -> booking -> calendar (cùng thứ tự với job hết hạn) để tránh deadlock
    const payment = await em
      .createQueryBuilder(PaymentTransaction, 'p')
      .setLock('pessimistic_write')
      .where('p.id = :id', { id: paymentId })
      .getOne();

    // Gói tin trùng hoặc đã xử lý: trả 02, tuyệt đối không cộng tiền lần nữa
    if (!payment || payment.status !== PaymentStatus.PENDING) {
      return IPN_RESPONSE.ALREADY_CONFIRMED;
    }

    const gatewayFields = {
      transaction_code: query.vnp_TransactionNo ?? null,
      vnp_response_code: query.vnp_ResponseCode ?? null,
      bank_code: query.vnp_BankCode ?? null,
      vnp_pay_date: query.vnp_PayDate ?? null,
      ipn_payload: query,
    };

    const success = query.vnp_ResponseCode === '00' && query.vnp_TransactionStatus === '00';
    if (!success) {
      await em.update(PaymentTransaction, { id: payment.id }, {
        ...gatewayFields,
        status: PaymentStatus.FAILED,
      });
      // Đơn giữ nguyên PENDING_PAYMENT để khách thử lại trong hạn giữ chỗ
      return IPN_RESPONSE.SUCCESS;
    }

    await em.update(PaymentTransaction, { id: payment.id }, {
      ...gatewayFields,
      status: PaymentStatus.SUCCESS,
      paid_at: new Date(),
    });

    const booking = await em
      .createQueryBuilder(Booking, 'b')
      .setLock('pessimistic_write')
      .where('b.id = :id', { id: payment.booking_id })
      .getOneOrFail();

    if (booking.status === BookingStatus.PENDING_PAYMENT) {
      await this.confirmBooking(em, booking, payment);
    } else if (booking.status === BookingStatus.EXPIRED) {
      await this.recoverExpiredBooking(em, booking, payment);
    } else {
      // Đơn đã bị hủy hoặc đã được thanh toán bởi giao dịch khác: hoàn lại tiền cho khách
      await this.queueRefund(em, booking, payment, 'Thanh toán cho đơn không còn chờ thanh toán');
    }
    return IPN_RESPONSE.SUCCESS;
  }

  /** PENDING_PAYMENT -> PAID_ESCROW, chốt kín lịch phòng, tạo ký quỹ Escrow */
  private async confirmBooking(
    em: EntityManager,
    booking: Booking,
    payment: PaymentTransaction,
  ): Promise<void> {
    const result = await em.update(
      Booking,
      { id: booking.id, status: BookingStatus.PENDING_PAYMENT },
      { status: BookingStatus.PAID_ESCROW, expires_at: null },
    );
    if (result.affected !== 1) return;

    // Chốt kín: giữ is_available = 0, bỏ locked_until để job hết hạn không mở lại
    await em
      .createQueryBuilder()
      .update(PriceCalendar)
      .set({ locked_until: null })
      .where('room_id = :roomId', { roomId: booking.room_id })
      .andWhere('date >= :checkIn AND date < :checkOut', {
        checkIn: booking.check_in_date,
        checkOut: booking.check_out_date,
      })
      .andWhere('is_available = 0')
      .execute();

    await this.createEscrow(em, booking, payment);
    this.logger.log(`Đơn ${booking.booking_code} đã thanh toán, tiền vào ký quỹ Escrow`);

    // Tự động đặt phòng ngầm qua Booking.com Demand API nếu là đơn Dropship
    if (booking.is_dropship === 1) {
      setTimeout(() => {
        void this.b2bFulfillmentService.fulfillDropshipBooking(booking.id).catch((err) => {
          this.logger.error(`[B2B Fulfillment Error] Đơn ${booking.booking_code}: ${err.message}`);
        });
      }, 300);
    }
  }

  /**
   * IPN thành công đến sau khi đơn đã EXPIRED: thử giữ lại phòng. Còn trống thì xác nhận
   * bình thường, đã có người đặt thì hủy đơn và hoàn 100% (BR-M1-10).
   */
  private async recoverExpiredBooking(
    em: EntityManager,
    booking: Booking,
    payment: PaymentTransaction,
  ): Promise<void> {
    const nights = listNights(booking.check_in_date, booking.check_out_date);
    const rows = await em
      .createQueryBuilder(PriceCalendar, 'pc')
      .setLock('pessimistic_write')
      .where('pc.room_id = :roomId', { roomId: booking.room_id })
      .andWhere('pc.date IN (:...nights)', { nights })
      .orderBy('pc.date', 'ASC')
      .getMany();

    const stillFree = rows.length === nights.length && rows.every((r) => r.is_available === 1);
    if (stillFree) {
      await em.update(PriceCalendar, { id: In(rows.map((r) => r.id)) }, {
        is_available: 0,
        locked_until: null,
      });
      await em.update(Booking, { id: booking.id }, {
        status: BookingStatus.PAID_ESCROW,
        expires_at: null,
      });
      await this.createEscrow(em, booking, payment);
      this.logger.log(`Đơn ${booking.booking_code} thanh toán muộn nhưng phòng còn trống, đã xác nhận`);
      return;
    }

    await em.update(Booking, { id: booking.id }, { status: BookingStatus.CANCELLED });
    await this.queueRefund(em, booking, payment, 'Thanh toán muộn, phòng đã có người đặt (LATE_PAYMENT)');
    this.logger.warn(`Đơn ${booking.booking_code} thanh toán muộn và hết phòng, chuyển hoàn tiền 100%`);
  }

  private async createEscrow(
    em: EntityManager,
    booking: Booking,
    payment: PaymentTransaction,
  ): Promise<void> {
    // Ước tính: 24h sau giờ nhận phòng 14:00; Host check-in sẽ ghi đè mốc thực tế
    const releaseDueAt = new Date(
      new Date(`${booking.check_in_date}T14:00:00+07:00`).getTime() + DAY_MS,
    );
    await em.save(
      em.create(EscrowHold, {
        booking_id: booking.id,
        amount: toVnd(payment.amount),
        status: EscrowStatus.HOLDING,
        release_due_at: releaseDueAt,
      }),
    );
  }

  private async queueRefund(
    em: EntityManager,
    booking: Booking,
    payment: PaymentTransaction,
    reason: string,
  ): Promise<void> {
    await em.save(
      em.create(RefundTransaction, {
        booking_id: booking.id,
        payment_id: payment.id,
        source: RefundSource.LATE_PAYMENT,
        refund_amount: toVnd(payment.amount),
        refund_percentage: 100,
        penalty_amount: 0,
        status: RefundStatus.PENDING,
        reason,
      }),
    );
  }

  // =========================================================
  // RETURN URL (chỉ hiển thị, không ghi DB)
  // =========================================================

  /** @returns địa chỉ trang kết quả của frontend để redirect khách về */
  async resolveReturnRedirect(rawQuery: Record<string, unknown>): Promise<string> {
    const query = this.normalizeQuery(rawQuery);
    let status: 'success' | 'failed' | 'invalid' = 'invalid';
    let paymentId = '';

    try {
      if (verifySignature(query, this.vnpConfig().secret)) {
        status = query.vnp_ResponseCode === '00' ? 'success' : 'failed';
        const payment = await this.paymentRepo.findOne({
          where: { vnp_txn_ref: query.vnp_TxnRef },
        });
        paymentId = payment?.id ?? '';
      }
    } catch {
      // Cấu hình thiếu hoặc lỗi DB: báo invalid, frontend sẽ tự hỏi lại trạng thái thật
    }

    const frontend = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
    // Kết quả này chỉ để hiển thị; frontend gọi GET /payments/:id để biết trạng thái thật do IPN ghi
    return `${frontend}/payment-result?status=${status}&payment_id=${encodeURIComponent(paymentId)}`;
  }

  // =========================================================
  // TRẠNG THÁI GIAO DỊCH (frontend polling)
  // =========================================================

  async getPayment(authUser: AuthUser, id: string) {
    const payment = await this.paymentRepo.findOne({
      where: { id },
      relations: { booking: true },
    });
    if (!payment || payment.booking?.customer_id !== authUser.id) {
      throw new NotFoundException('Không tìm thấy giao dịch');
    }

    return {
      id: payment.id,
      booking_id: payment.booking_id,
      booking_code: payment.booking.booking_code,
      booking_status: payment.booking.status,
      is_dropship: payment.booking.is_dropship === 1,
      ota_fulfillment: payment.booking.ota_fulfillment_json ?? null,
      amount: toVnd(payment.amount),
      status: payment.status,
      paid_at: payment.paid_at,
    };
  }

  // =========================================================
  // PRIVATE HELPERS
  // =========================================================

  private vnpConfig() {
    const tmnCode = this.configService.get<string>('VNP_TMN_CODE');
    const secret = this.configService.get<string>('VNP_HASH_SECRET');
    if (!tmnCode || !secret) {
      throw new ServiceUnavailableException('Cổng thanh toán VNPay chưa được cấu hình');
    }
    return {
      tmnCode,
      secret,
      url: this.configService.get<string>('VNP_URL', SANDBOX_URL),
      returnUrl: this.configService.get<string>(
        'VNP_RETURN_URL',
        'http://localhost:3000/api/v1/vnpay/return',
      ),
    };
  }

  /** Express có thể trả mảng khi một tham số lặp lại; chỉ nhận chuỗi */
  private normalizeQuery(raw: Record<string, unknown>): Record<string, string> {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === 'string') query[key] = first;
    }
    return query;
  }
}
