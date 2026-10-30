import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PaymentTransaction,
  PayoutRequest,
  PayoutStatus,
} from './entities/index.js';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity.js';
import { EscrowHold, EscrowStatus } from '../bookings/entities/escrow-hold.entity.js';
import { RequestPayoutDto } from './dto/request-payout.dto.js';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(PayoutRequest)
    private readonly payoutRepo: Repository<PayoutRequest>,
    @InjectRepository(PaymentTransaction)
    private readonly paymentTxRepo: Repository<PaymentTransaction>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(EscrowHold)
    private readonly escrowRepo: Repository<EscrowHold>,
  ) {}

  // ==========================================
  // 1. SỐ DƯ & ĐỐI SOÁT GIẢI NGÂN (GET /host/payouts/balance)
  // ==========================================

  async getHostBalance(hostId: string) {
    // Lấy các đơn hàng đã hoàn tất lưu trú (hoặc check-in qua 24h Escrow)
    const bookings = await this.bookingRepo
      .createQueryBuilder('booking')
      .innerJoinAndSelect('booking.room', 'room')
      .innerJoinAndSelect('room.homestay', 'homestay')
      .leftJoinAndSelect('booking.escrow', 'escrow')
      .leftJoinAndSelect('booking.payout', 'payout')
      .where('homestay.host_id = :hostId', { hostId })
      .andWhere('booking.status IN (:...statuses)', {
        statuses: [BookingStatus.COMPLETED, BookingStatus.CHECKED_IN],
      })
      .getMany();

    const now = new Date();
    const eligibleBookings: Booking[] = [];
    let availableGross = 0;

    for (const b of bookings) {
      // Đã tạo Payout rồi thì bỏ qua
      if (b.payout) continue;

      // Kiểm tra hạn giữ tiền Escrow 24h
      const isEscrowMatured =
        !b.escrow || !b.escrow.release_due_at || new Date(b.escrow.release_due_at) <= now;

      if (isEscrowMatured) {
        eligibleBookings.push(b);
        availableGross += Number(b.total_amount) || 0;
      }
    }

    const commissionRate = 0.075; // 7.5% theo thiết kế sàn
    const platformCommission = Math.round(availableGross * commissionRate);
    const availableNetPayout = availableGross - platformCommission;

    // Lấy tổng số tiền đang chờ Admin giải ngân (PENDING)
    const pendingPayouts = await this.payoutRepo.find({
      where: { host_id: hostId, status: PayoutStatus.PENDING },
    });
    const pendingAmount = pendingPayouts.reduce(
      (sum, p) => sum + (Number(p.actual_payout_amount) || 0),
      0,
    );

    // Lấy tổng số tiền đã được giải ngân thành công (PAID_OUT)
    const completedPayouts = await this.payoutRepo.find({
      where: { host_id: hostId, status: PayoutStatus.PAID_OUT },
    });
    const totalPaidOut = completedPayouts.reduce(
      (sum, p) => sum + (Number(p.actual_payout_amount) || 0),
      0,
    );

    return {
      available_gross: availableGross,
      commission_rate: commissionRate,
      platform_commission: platformCommission,
      available_net_payout: availableNetPayout,
      pending_payout_amount: pendingAmount,
      total_paid_out: totalPaidOut,
      eligible_bookings_count: eligibleBookings.length,
      eligible_bookings: eligibleBookings.map((b) => ({
        id: b.id,
        booking_code: b.booking_code,
        room_name: b.room?.room_name,
        homestay_name: b.room?.homestay?.name,
        total_amount: Number(b.total_amount),
        check_out_date: b.check_out_date,
      })),
    };
  }

  // ==========================================
  // 2. YÊU CẦU GIẢI NGÂN (POST /host/payouts/request)
  // ==========================================

  async requestPayout(hostId: string, dto: RequestPayoutDto) {
    let bookingsToPayout: Booking[] = [];

    if (dto.booking_id) {
      const booking = await this.bookingRepo.findOne({
        where: { id: dto.booking_id },
        relations: ['room', 'room.homestay', 'escrow', 'payout'],
      });

      if (!booking) {
        throw new NotFoundException(`Không tìm thấy đơn hàng #${dto.booking_id}`);
      }

      if (booking.room?.homestay?.host_id !== hostId) {
        throw new ForbiddenException('Bạn không sở hữu đơn hàng này');
      }

      if (booking.payout) {
        throw new ConflictException(
          `Đơn hàng #${booking.booking_code} đã được tạo yêu cầu giải ngân trước đó (Trạng thái: ${booking.payout.status}).`,
        );
      }

      const now = new Date();
      if (
        booking.escrow?.release_due_at &&
        new Date(booking.escrow.release_due_at) > now
      ) {
        throw new BadRequestException(
          `Đơn hàng chưa qua thời hạn giữ tiền Escrow 24h (Đến hạn lúc: ${booking.escrow.release_due_at}).`,
        );
      }

      bookingsToPayout.push(booking);
    } else {
      // Yêu cầu giải ngân toàn bộ số dư hợp lệ
      const balance = await this.getHostBalance(hostId);
      if (balance.eligible_bookings_count === 0) {
        throw new BadRequestException(
          'Hiện không có đơn hàng nào đủ điều kiện giải ngân (hoặc chưa hết 24h Escrow).',
        );
      }

      const ids = balance.eligible_bookings.map((b) => b.id);
      bookingsToPayout = await this.bookingRepo
        .createQueryBuilder('booking')
        .whereInIds(ids)
        .getMany();
    }

    const createdPayouts: PayoutRequest[] = [];
    const commissionRate = 0.075;

    for (const b of bookingsToPayout) {
      const totalAmount = Number(b.total_amount) || 0;
      const commission = Math.round(totalAmount * commissionRate);
      const actualPayout = totalAmount - commission;

      const payout = this.payoutRepo.create({
        host_id: hostId,
        booking_id: b.id,
        total_booking_amount: totalAmount,
        platform_commission: commission,
        actual_payout_amount: actualPayout,
        status: PayoutStatus.PENDING,
      });

      createdPayouts.push(await this.payoutRepo.save(payout));
    }

    this.logger.log(
      `Host #${hostId} đã tạo ${createdPayouts.length} yêu cầu giải ngân mới.`,
    );

    return {
      message: `Đã tạo thành công ${createdPayouts.length} yêu cầu giải ngân. Vui lòng chờ Admin duyệt chuyển khoản.`,
      payouts: createdPayouts,
    };
  }

  // ==========================================
  // 3. LỊCH SỬ GIẢI NGÂN (GET /host/payouts/history)
  // ==========================================

  async getPayoutHistory(hostId: string) {
    const payouts = await this.payoutRepo.find({
      where: { host_id: hostId },
      relations: ['booking', 'booking.room', 'booking.room.homestay'],
      order: { created_at: 'DESC' },
    });

    return payouts.map((p) => ({
      id: p.id,
      payout_code: `PO-${new Date(p.created_at).toISOString().slice(0, 10).replace(/-/g, '')}-${String(p.id).padStart(4, '0')}`,
      booking_code: p.booking?.booking_code || 'N/A',
      homestay_name: p.booking?.room?.homestay?.name || 'N/A',
      room_name: p.booking?.room?.room_name || 'N/A',
      gross_amount: Number(p.total_booking_amount) || 0,
      commission: Number(p.platform_commission) || 0,
      net_amount: Number(p.actual_payout_amount) || 0,
      status: p.status,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));
  }
}
