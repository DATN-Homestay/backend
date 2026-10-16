import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Booking } from './booking.entity.js';

export enum EscrowStatus {
  HOLDING = 'HOLDING',
  RELEASED = 'RELEASED',
  REFUNDED = 'REFUNDED',
}

@Entity({ name: 'escrow_holds' })
export class EscrowHold {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_escrow_holds_booking_id', { unique: true })
  @Column({ type: 'bigint', unsigned: true })
  booking_id: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, comment: 'Số tiền ký quỹ đang tạm giữ' })
  amount: number;

  @Column({
    type: 'enum',
    enum: EscrowStatus,
    default: EscrowStatus.HOLDING,
  })
  status: EscrowStatus;

  @Column({
    type: 'timestamp',
    comment: 'Thời điểm đến hạn giải ngân (24h sau check-in thành công)',
  })
  release_due_at: Date;

  @Column({ type: 'timestamp', nullable: true, comment: 'Thời điểm thực tế đã giải ngân' })
  released_at: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @OneToOne(() => Booking, (booking) => booking.escrow, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;
}
