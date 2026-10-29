import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Booking, BookingStatus } from './entities/booking.entity.js';
import { EscrowHold, EscrowStatus } from './entities/escrow-hold.entity.js';
import {
  RefundSource,
  RefundStatus,
  RefundTransaction,
} from './entities/refund-transaction.entity.js';
import { PaymentStatus, PaymentTransaction } from '../payments/entities/payment-transaction.entity.js';
import { Room } from '../homestays/entities/room.entity.js';
import { PriceCalendar } from '../homestays/entities/price-calendar.entity.js';
import type { AuthUser } from '../auth/auth.types.js';
import { RefundProcessorService } from './refund-processor.service.js';
import { calculateHostCancel, calculateRefund, hoursUntilCheckIn } from './cancellation-policy.js';
import { daysBetween, toVnd } from './booking.utils.js';
import { CancelBookingDto } from './dto/cancel-booking.dto.js';

type Canceller = 'CUSTOMER' | 'HOST';

/**
 * Cancellation Service - Hủy đơn và hoàn tiền Escrow (FLOW-11, BR-021, GĐ5).
 * Mọi thay đổi trạng thái đều nằm trong transaction có khóa dòng booking nên bấm hủy đồng thời
 * nhiều lần chỉ có đúng một lần thành công và chỉ sinh đúng một yêu cầu hoàn tiền.
 */
@Injectable()
export class CancellationService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(PaymentTransaction)
    private readonly paymentRepo: Repository<PaymentTransaction>,
    @InjectRepository(RefundTransaction)
    private readonly refundRepo: Repository<RefundTransaction>,
    private readonly refundProcessor: RefundProcessorService,
  ) {}

  // =========================================================
  // XEM TRƯỚC SỐ TIỀN HOÀN
  // =========================================================

  async quote(authUser: AuthUser, bookingId: string, now = new Date()) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, customer_id: authUser.id },
      relations: { room: { homestay: true } },
    });
    if (!booking?.room?.homestay) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng');
    }
    const policy = booking.room.homestay.cancellation_policy;
    const base = {
      booking_code: booking.booking_code,
      status: booking.status,
      policy,
    };

    if (booking.status === BookingStatus.PENDING_PAYMENT) {
      return {
        ...base,
        can_cancel: true,
        reason_cannot: null,
        paid_amount: 0,
        refund_amount: 0,
        retained_amount: 0,
        refund_percent: 0,
        hours_before_check_in: this.hours(booking, now),
        rule: 'Đơn chưa thanh toán nên hủy không mất phí và không có khoản nào cần hoàn.',
      };
    }

    if (booking.status !== BookingStatus.PAID_ESCROW) {
      return this.cannotCancel(base, this.statusReason(booking.status));
    }
    if (this.hours(booking, now) <= 0) {
      return this.cannotCancel(
        base,
        'Đã quá giờ nhận phòng nên không thể hủy trực tuyến. Vui lòng liên hệ chủ nhà hoặc gửi khiếu nại.',
      );
    }

    const paid = await this.paidAmount(this.paymentRepo, booking.id);
    const calc = calculateRefund({
      policy,
      totalAmount: toVnd(booking.total_amount),
      nights: daysBetween(booking.check_in_date, booking.check_out_date),
      paidAmount: paid,
      checkInDate: booking.check_in_date,
      now,
    });
    return {
      ...base,
      can_cancel: true,
      reason_cannot: null,
      paid_amount: paid,
      refund_amount: calc.refundAmount,
      retained_amount: calc.retainedAmount,
      refund_percent: calc.refundablePercent,
      hours_before_check_in: calc.hoursBeforeCheckIn,
      rule: calc.rule,
    };
  }

  // =========================================================
  // KHÁCH HỦY ĐƠN
  // =========================================================

  async cancelByCustomer(authUser: AuthUser, bookingId: string, dto: CancelBookingDto) {
    const outcome = await this.dataSource.transaction(async (em) => {
      const booking = await this.lockBooking(em, bookingId, { customerId: authUser.id });
      const room = await this.loadRoom(em, booking);

      if (booking.status === BookingStatus.PENDING_PAYMENT) {
        await this.markCancelled(em, booking, BookingStatus.PENDING_PAYMENT, 'CUSTOMER', dto.reason);
        // Mở lại các đêm đang bị GIỮ chờ thanh toán. Nếu IPN VNPay đến muộn, nhánh xử lý
        // "đơn không còn chờ thanh toán" sẽ tự hoàn tiền (customer-payments.service)
        await this.reopenCalendar(em, booking, { heldOnly: true });
        return { refund: null as RefundTransaction | null, refundAmount: 0, retained: 0, rule: 'Đơn chưa thanh toán nên hủy không mất phí.' };
      }

      if (booking.status !== BookingStatus.PAID_ESCROW) {
        throw new ConflictException(this.statusReason(booking.status));
      }

      const now = new Date();
      if (this.hours(booking, now) <= 0) {
        throw new ConflictException('Đã quá giờ nhận phòng nên không thể hủy trực tuyến');
      }

      const payments = await em.find(PaymentTransaction, {
        where: { booking_id: booking.id, status: PaymentStatus.SUCCESS },
        order: { id: 'ASC' },
      });
      const paid = payments.reduce((sum, p) => sum + toVnd(p.amount), 0);
      const calc = calculateRefund({
        policy: room.homestay.cancellation_policy,
        totalAmount: toVnd(booking.total_amount),
        nights: daysBetween(booking.check_in_date, booking.check_out_date),
        paidAmount: paid,
        checkInDate: booking.check_in_date,
        now,
      });

      // Khách đã xem một số tiền ở bước báo giá: nếu khác thì bắt xác nhận lại, không âm thầm đổi
      if (dto.expected_refund_amount !== undefined && dto.expected_refund_amount !== calc.refundAmount) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          error_code: 'REFUND_AMOUNT_CHANGED',
          message: 'Số tiền được hoàn đã thay đổi so với lúc bạn xem, vui lòng kiểm tra lại.',
          refund_amount: calc.refundAmount,
        });
      }

      await this.markCancelled(em, booking, BookingStatus.PAID_ESCROW, 'CUSTOMER', dto.reason);
      await this.reopenCalendar(em, booking, { heldOnly: false });
      await this.settleEscrow(em, booking.id, calc.refundAmount, calc.retainedAmount);

      const refund = await this.createRefund(em, {
        bookingId: booking.id,
        payment: payments[payments.length - 1],
        amount: calc.refundAmount,
        percent: calc.refundablePercent,
        penalty: 0,
        source: RefundSource.CUSTOMER_CANCEL,
        reason: calc.rule,
      });
      return { refund, refundAmount: calc.refundAmount, retained: calc.retainedAmount, rule: calc.rule };
    });

    return this.result(bookingId, outcome);
  }

  // =========================================================
  // HOST HỦY ĐƠN (BR-021: hoàn 100% cho khách, Host bị phạt 20%)
  // =========================================================

  async cancelByHost(authUser: AuthUser, bookingId: string, dto: CancelBookingDto) {
    const outcome = await this.dataSource.transaction(async (em) => {
      const booking = await this.lockBooking(em, bookingId, {});
      const room = await this.loadRoom(em, booking);
      // Người không phải Host của nhà này nhận 404 để không lộ sự tồn tại của đơn
      if (room.homestay.host_id !== authUser.id) {
        throw new NotFoundException('Không tìm thấy đơn đặt phòng');
      }
      if (booking.status !== BookingStatus.PAID_ESCROW) {
        throw new ConflictException(
          booking.status === BookingStatus.PENDING_PAYMENT
            ? 'Đơn chưa được thanh toán nên chưa thể hủy'
            : this.statusReason(booking.status),
        );
      }

      const payments = await em.find(PaymentTransaction, {
        where: { booking_id: booking.id, status: PaymentStatus.SUCCESS },
        order: { id: 'ASC' },
      });
      const paid = payments.reduce((sum, p) => sum + toVnd(p.amount), 0);
      const host = calculateHostCancel(toVnd(booking.total_amount), paid);

      await this.markCancelled(em, booking, BookingStatus.PAID_ESCROW, 'HOST', dto.reason);
      // Các đêm này được GIỮ KHÓA (không mở lại) để Host không bán lại lịch vừa hủy
      await this.settleEscrow(em, booking.id, host.refundAmount, 0);

      const refund = await this.createRefund(em, {
        bookingId: booking.id,
        payment: payments[payments.length - 1],
        amount: host.refundAmount,
        percent: 100,
        penalty: host.penaltyAmount,
        source: RefundSource.HOST_CANCEL,
        reason: `Chủ nhà hủy đơn: ${dto.reason}`,
      });
      return {
        refund,
        refundAmount: host.refundAmount,
        retained: 0,
        rule: 'Chủ nhà hủy đơn nên khách được hoàn 100%. Chủ nhà bị phạt 20% giá trị đơn, trừ vào kỳ đối soát sau.',
      };
    });

    return this.result(bookingId, outcome);
  }

  // =========================================================
  // LỊCH SỬ HOÀN TIỀN CỦA KHÁCH
  // =========================================================

  async listMyRefunds(authUser: AuthUser) {
    const rows = await this.refundRepo
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.booking', 'b')
      .where('b.customer_id = :uid', { uid: authUser.id })
      .orderBy('r.id', 'DESC')
      .take(100)
      .getMany();

    return rows.map((r) => ({
      id: r.id,
      booking_code: r.booking.booking_code,
      source: r.source,
      refund_amount: toVnd(r.refund_amount),
      status: r.status,
      reason: r.reason,
      processed_at: r.processed_at,
      created_at: r.created_at,
    }));
  }

  // =========================================================
  // PRIVATE HELPERS
  // =========================================================

  /** Khóa dòng booking; customerId có giá trị thì chỉ chủ đơn mới tìm thấy (người khác nhận 404) */
  private async lockBooking(em: EntityManager, id: string, scope: { customerId?: string }): Promise<Booking> {
    const qb = em.createQueryBuilder(Booking, 'b').setLock('pessimistic_write').where('b.id = :id', { id });
    if (scope.customerId) qb.andWhere('b.customer_id = :cid', { cid: scope.customerId });
    const booking = await qb.getOne();
    if (!booking) throw new NotFoundException('Không tìm thấy đơn đặt phòng');
    return booking;
  }

  private async loadRoom(em: EntityManager, booking: Booking): Promise<Room> {
    const room = await em.findOne(Room, { where: { id: booking.room_id }, relations: { homestay: true } });
    if (!room?.homestay) throw new NotFoundException('Không tìm thấy phòng của đơn');
    return room;
  }

  /** Chuyển CANCELLED có điều kiện trạng thái; 0 dòng nghĩa là có request khác đã xử lý trước */
  private async markCancelled(
    em: EntityManager,
    booking: Booking,
    from: BookingStatus,
    by: Canceller,
    reason: string,
  ): Promise<void> {
    const result = await em.update(
      Booking,
      { id: booking.id, status: from },
      {
        status: BookingStatus.CANCELLED,
        cancelled_at: new Date(),
        cancelled_by: by,
        cancel_reason: reason,
        expires_at: null,
      },
    );
    if (result.affected !== 1) {
      throw new ConflictException('Đơn đã được xử lý bởi một thao tác khác, vui lòng tải lại');
    }
  }

  /** heldOnly: chỉ mở các đêm đang bị giữ chờ thanh toán; ngược lại mở cả các đêm đã chốt của đơn */
  private async reopenCalendar(em: EntityManager, booking: Booking, opts: { heldOnly: boolean }): Promise<void> {
    const qb = em
      .createQueryBuilder()
      .update(PriceCalendar)
      .set({ is_available: 1, locked_until: null })
      .where('room_id = :roomId', { roomId: booking.room_id })
      .andWhere('date >= :checkIn AND date < :checkOut', {
        checkIn: booking.check_in_date,
        checkOut: booking.check_out_date,
      })
      .andWhere('is_available = 0');
    if (opts.heldOnly) qb.andWhere('locked_until IS NOT NULL');
    await qb.execute();
  }

  /**
   * Cập nhật ký quỹ sau khi hủy: hoàn hết thì REFUNDED; hoàn một phần thì chỉ còn lại phần sàn giữ cho Host.
   * LƯU Ý: Payout hiện chỉ tính đơn COMPLETED/CHECKED_IN nên phần giữ lại của đơn đã hủy cần Module 3 bổ sung.
   */
  private async settleEscrow(em: EntityManager, bookingId: string, refundAmount: number, retained: number): Promise<void> {
    if (refundAmount <= 0) return;
    const escrow = await em.findOne(EscrowHold, { where: { booking_id: bookingId } });
    if (!escrow) return;
    if (retained > 0) {
      escrow.amount = retained;
    } else {
      escrow.status = EscrowStatus.REFUNDED;
    }
    await em.save(escrow);
  }

  private async createRefund(
    em: EntityManager,
    input: {
      bookingId: string;
      payment: PaymentTransaction | undefined;
      amount: number;
      percent: number;
      penalty: number;
      source: RefundSource;
      reason: string;
    },
  ): Promise<RefundTransaction | null> {
    if (input.amount <= 0) return null;
    return em.save(
      em.create(RefundTransaction, {
        booking_id: input.bookingId,
        payment_id: input.payment?.id ?? null,
        source: input.source,
        refund_amount: input.amount,
        refund_percentage: input.percent,
        penalty_amount: input.penalty,
        status: RefundStatus.PENDING,
        reason: input.reason.slice(0, 500),
      }),
    );
  }

  /** Kích hoạt hoàn tiền sau khi transaction đã commit, rồi dựng phản hồi cho client */
  private result(
    bookingId: string,
    outcome: { refund: RefundTransaction | null; refundAmount: number; retained: number; rule: string },
  ) {
    if (outcome.refund) this.refundProcessor.processInBackground(outcome.refund.id);
    return {
      booking_id: bookingId,
      status: BookingStatus.CANCELLED,
      refund: outcome.refund
        ? { id: outcome.refund.id, amount: outcome.refundAmount, status: outcome.refund.status }
        : null,
      retained_amount: outcome.retained,
      rule: outcome.rule,
      message: outcome.refund
        ? `Đã hủy đơn. ${outcome.refundAmount.toLocaleString('vi-VN')}đ sẽ được hoàn về phương thức thanh toán của bạn.`
        : 'Đã hủy đơn.',
    };
  }

  private async paidAmount(repo: Repository<PaymentTransaction>, bookingId: string): Promise<number> {
    const payments = await repo.find({ where: { booking_id: bookingId, status: PaymentStatus.SUCCESS } });
    return payments.reduce((sum, p) => sum + toVnd(p.amount), 0);
  }

  private hours(booking: Booking, now: Date): number {
    return Math.round(hoursUntilCheckIn(booking.check_in_date, now) * 10) / 10;
  }

  private cannotCancel(base: Record<string, unknown>, reason: string) {
    return {
      ...base,
      can_cancel: false,
      reason_cannot: reason,
      paid_amount: 0,
      refund_amount: 0,
      retained_amount: 0,
      refund_percent: 0,
      hours_before_check_in: null,
      rule: null,
    };
  }

  private statusReason(status: BookingStatus): string {
    switch (status) {
      case BookingStatus.CANCELLED:
        return 'Đơn này đã được hủy trước đó';
      case BookingStatus.EXPIRED:
        return 'Đơn đã hết hạn giữ chỗ';
      case BookingStatus.CHECKED_IN:
        return 'Bạn đã nhận phòng nên không thể hủy, vui lòng gửi khiếu nại nếu có vấn đề';
      case BookingStatus.COMPLETED:
        return 'Đơn đã hoàn tất, không thể hủy';
      default:
        return 'Không thể hủy đơn ở trạng thái hiện tại';
    }
  }
}
