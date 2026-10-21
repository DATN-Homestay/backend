import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Booking, BookingStatus } from './entities/booking.entity.js';
import { PriceCalendar } from '../homestays/entities/price-calendar.entity.js';

const BATCH_SIZE = 100;

/**
 * Hết hạn giữ chỗ (BR-007): đơn PENDING_PAYMENT quá expires_at chuyển EXPIRED và mở lại lịch phòng.
 */
@Injectable()
export class BookingExpiryService {
  private readonly logger = new Logger(BookingExpiryService.name);
  private running = false;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    // Tránh chạy chồng khi lần trước chưa xong
    if (this.running) return;
    this.running = true;
    try {
      const count = await this.expireOverdueBookings();
      if (count > 0) {
        this.logger.log(`Đã hết hạn giữ chỗ ${count} đơn và mở lại lịch phòng`);
      }
    } catch (error) {
      this.logger.error(
        `Lỗi job hết hạn giữ chỗ: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** @returns số đơn đã chuyển sang EXPIRED */
  async expireOverdueBookings(now = new Date()): Promise<number> {
    const overdue = await this.bookingRepo.find({
      where: { status: BookingStatus.PENDING_PAYMENT, expires_at: LessThan(now) },
      take: BATCH_SIZE,
    });

    let expired = 0;
    for (const booking of overdue) {
      expired += await this.expireOne(booking, now);
    }
    return expired;
  }

  private async expireOne(booking: Booking, now: Date): Promise<number> {
    return this.dataSource.transaction(async (em) => {
      // Cập nhật có điều kiện: nếu IPN VNPay vừa chuyển đơn sang PAID_ESCROW thì không đụng vào
      const result = await em.update(
        Booking,
        {
          id: booking.id,
          status: BookingStatus.PENDING_PAYMENT,
          expires_at: LessThan(now),
        },
        { status: BookingStatus.EXPIRED },
      );
      if (result.affected !== 1) return 0;

      // Chỉ mở lại các ngày đang bị GIỮ (locked_until != NULL), không đụng ngày Host chủ động khóa
      await em
        .createQueryBuilder()
        .update(PriceCalendar)
        .set({ is_available: 1, locked_until: null })
        .where('room_id = :roomId', { roomId: booking.room_id })
        .andWhere('date >= :checkIn AND date < :checkOut', {
          checkIn: booking.check_in_date,
          checkOut: booking.check_out_date,
        })
        .andWhere('is_available = 0')
        .andWhere('locked_until IS NOT NULL')
        .execute();
      return 1;
    });
  }
}
