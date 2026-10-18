import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Booking,
  BookingStatus,
  EscrowHold,
  EscrowStatus,
  RefundTransaction,
} from './entities/index.js';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(EscrowHold)
    private readonly escrowRepo: Repository<EscrowHold>,
    @InjectRepository(RefundTransaction)
    private readonly refundRepo: Repository<RefundTransaction>,
  ) {}

  // ==========================================
  // HOST BOOKING MANAGEMENT
  // ==========================================

  async getHostBookings(
    hostId: string,
    homestayId?: string,
    status?: BookingStatus,
    fromDate?: string,
    toDate?: string,
  ) {
    const qb = this.bookingRepo
      .createQueryBuilder('booking')
      .innerJoinAndSelect('booking.room', 'room')
      .innerJoinAndSelect('room.homestay', 'homestay')
      .leftJoinAndSelect('booking.customer', 'customer')
      .leftJoinAndSelect('booking.escrow', 'escrow')
      .where('homestay.host_id = :hostId', { hostId });

    if (homestayId) {
      qb.andWhere('homestay.id = :homestayId', { homestayId });
    }

    if (status) {
      qb.andWhere('booking.status = :status', { status });
    }

    if (fromDate && toDate) {
      qb.andWhere('booking.check_in_date BETWEEN :fromDate AND :toDate', {
        fromDate,
        toDate,
      });
    }

    qb.orderBy('booking.created_at', 'DESC');
    return await qb.getMany();
  }

  async checkIn(hostId: string, bookingId: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
      relations: ['room', 'room.homestay', 'escrow'],
    });

    if (!booking) {
      throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
    }

    if (booking.room?.homestay?.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu homestay của đơn đặt phòng này');
    }

    if (
      booking.status !== BookingStatus.PAID_ESCROW &&
      booking.status !== BookingStatus.PENDING_PAYMENT
    ) {
      throw new BadRequestException(
        `Không thể check-in đơn hàng ở trạng thái hiện tại: ${booking.status}`,
      );
    }

    booking.status = BookingStatus.CHECKED_IN;
    await this.bookingRepo.save(booking);

    // Kích hoạt ký quỹ Escrow: Thời điểm giải ngân = NOW() + 24 giờ
    const releaseDueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    let escrow = booking.escrow;
    if (!escrow) {
      escrow = this.escrowRepo.create({
        booking_id: booking.id,
        amount: booking.total_amount,
        status: EscrowStatus.HOLDING,
        release_due_at: releaseDueAt,
      });
    } else {
      escrow.release_due_at = releaseDueAt;
      escrow.status = EscrowStatus.HOLDING;
    }
    await this.escrowRepo.save(escrow);

    this.logger.log(
      `Host #${hostId} xác nhận CHECK-IN đơn #${booking.booking_code}. Escrow giải ngân vào ${releaseDueAt.toISOString()}`,
    );

    return {
      booking_id: Number(booking.id),
      booking_code: booking.booking_code,
      status: booking.status,
      checked_in_at: new Date().toISOString(),
      escrow_release_due_at: releaseDueAt.toISOString(),
    };
  }

  async checkOut(hostId: string, bookingId: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
      relations: ['room', 'room.homestay', 'escrow'],
    });

    if (!booking) {
      throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${bookingId}`);
    }

    if (booking.room?.homestay?.host_id !== hostId) {
      throw new ForbiddenException('Bạn không sở hữu homestay của đơn đặt phòng này');
    }

    if (booking.status !== BookingStatus.CHECKED_IN) {
      throw new BadRequestException(
        'Đơn hàng phải ở trạng thái CHECKED_IN trước khi xác nhận Check-out',
      );
    }

    booking.status = BookingStatus.COMPLETED;
    await this.bookingRepo.save(booking);

    this.logger.log(
      `Host #${hostId} xác nhận CHECK-OUT hoàn tất đơn #${booking.booking_code}`,
    );

    return {
      booking_id: Number(booking.id),
      booking_code: booking.booking_code,
      status: booking.status,
      checked_out_at: new Date().toISOString(),
    };
  }
}
