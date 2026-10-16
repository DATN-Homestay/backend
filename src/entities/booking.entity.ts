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
} from 'typeorm';
import { User } from './user.entity.js';
import { Room } from './room.entity.js';
import { PaymentTransaction } from './payment-transaction.entity.js';
import { EscrowHold } from './escrow-hold.entity.js';
import { RefundTransaction } from './refund-transaction.entity.js';
import { PayoutRequest } from './payout-request.entity.js';
import { Review } from './review.entity.js';

export enum BookingStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID_ESCROW = 'PAID_ESCROW',
  CHECKED_IN = 'CHECKED_IN',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  DISPUTED = 'DISPUTED',
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
  customer: User;

  @ManyToOne(() => Room, (room) => room.bookings, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'room_id' })
  room: Room;

  @OneToMany(() => PaymentTransaction, (tx) => tx.booking)
  payments: PaymentTransaction[];

  @OneToOne(() => EscrowHold, (escrow) => escrow.booking)
  escrow: EscrowHold;

  @OneToMany(() => RefundTransaction, (refund) => refund.booking)
  refunds: RefundTransaction[];

  @OneToOne(() => PayoutRequest, (payout) => payout.booking)
  payout: PayoutRequest;

  @OneToOne(() => Review, (review) => review.booking)
  review: Review;
}
