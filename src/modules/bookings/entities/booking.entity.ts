import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
  Index,
  type Relation,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { Room } from '../../homestays/entities/room.entity.js';
import { PaymentTransaction } from '../../payments/entities/payment-transaction.entity.js';
import { EscrowHold } from './escrow-hold.entity.js';
import { RefundTransaction } from './refund-transaction.entity.js';
import { PayoutRequest } from '../../payments/entities/payout-request.entity.js';
import { Review } from '../../reviews/entities/review.entity.js';

export enum BookingStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID_ESCROW = 'PAID_ESCROW',
  CHECKED_IN = 'CHECKED_IN',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  DISPUTED = 'DISPUTED',
  /** Quá 15 phút giữ chỗ mà chưa thanh toán; phòng đã được mở lại */
  EXPIRED = 'EXPIRED',
}

@Entity({ name: 'bookings' })
export class Booking {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_bookings_code', { unique: true })
  @Column({ type: 'varchar', length: 50, comment: 'Mã đơn đặt phòng duy nhất, ví dụ: BK-8829' })
  booking_code: string;

  @Index('idx_bookings_customer_id')
  @Column({ type: 'bigint', unsigned: true })
  customer_id: string;

  @Index('idx_bookings_room_id')
  @Column({ type: 'bigint', unsigned: true })
  room_id: string;

  @Column({ type: 'date' })
  check_in_date: string;

  @Column({ type: 'date' })
  check_out_date: string;

  @Column({ type: 'int', default: 1 })
  num_guests: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, comment: 'Tiền phòng gốc' })
  room_subtotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0, comment: 'Phí dịch vụ sàn' })
  service_fee: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0, comment: 'Tiền giảm giá từ voucher' })
  discount_amount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, comment: 'Tổng tiền khách phải trả (Server tính)' })
  total_amount: number;

  @Column({ type: 'varchar', length: 500, nullable: true, comment: 'Ghi chú của khách khi đặt phòng' })
  customer_note: string | null;

  @Column({
    type: 'tinyint',
    default: 0,
    comment: '1: Đặt vào homestay chưa có chủ (is_claimed = 0), chuyển Admin Concierge đặt hộ',
  })
  is_dropship: number;

  @Column({
    type: 'json',
    nullable: true,
    comment: 'Thông tin kết quả đặt phòng B2B Demand API Booking.com',
  })
  ota_fulfillment_json: Record<string, any> | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelled_at: Date | null;

  @Column({
    type: 'enum',
    enum: ['CUSTOMER', 'HOST', 'ADMIN', 'SYSTEM'],
    nullable: true,
    comment: 'Ai hủy đơn',
  })
  cancelled_by: 'CUSTOMER' | 'HOST' | 'ADMIN' | 'SYSTEM' | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  cancel_reason: string | null;

  @Index('idx_bookings_expires_at')
  @Column({
    type: 'timestamp',
    nullable: true,
    comment: 'Hạn giữ chỗ 15 phút chờ thanh toán VNPay',
  })
  expires_at: Date | null;

  @Index('idx_bookings_status')
  @Column({
    type: 'enum',
    enum: BookingStatus,
    default: BookingStatus.PENDING_PAYMENT,
  })
  status: BookingStatus;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => User, (user) => user.bookings, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer: Relation<User>;

  @ManyToOne(() => Room, (room) => room.bookings, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'room_id' })
  room: Relation<Room>;

  @OneToMany(() => PaymentTransaction, (tx) => tx.booking)
  payments: Relation<PaymentTransaction[]>;

  @OneToOne(() => EscrowHold, (escrow) => escrow.booking)
  escrow: Relation<EscrowHold>;

  @OneToMany(() => RefundTransaction, (refund) => refund.booking)
  refunds: Relation<RefundTransaction[]>;

  @OneToOne(() => PayoutRequest, (payout) => payout.booking)
  payout: Relation<PayoutRequest>;

  @OneToOne(() => Review, (review) => review.booking)
  review: Relation<Review>;
}
