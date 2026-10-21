import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  type Relation,
} from 'typeorm';
import { Booking } from './booking.entity.js';

export enum RefundStatus {
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}

@Entity({ name: 'refund_transactions' })
export class RefundTransaction {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_refund_transactions_booking_id')
  @Column({ type: 'bigint', unsigned: true })
  booking_id: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, comment: 'Số tiền Sàn hoàn lại cho Khách' })
  refund_amount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0, comment: 'Phí phạt hủy phòng' })
  penalty_amount: number;

  @Column({
    type: 'enum',
    enum: RefundStatus,
    default: RefundStatus.PENDING,
  })
  status: RefundStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => Booking, (booking) => booking.refunds, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Relation<Booking>;
}
