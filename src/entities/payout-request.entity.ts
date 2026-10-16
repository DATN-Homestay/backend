import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Index,
  type Relation,
} from 'typeorm';
import { User } from './user.entity.js';
import { Booking } from './booking.entity.js';

export enum PayoutStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  PAID_OUT = 'PAID_OUT',
  REJECTED = 'REJECTED',
}

@Entity({ name: 'payout_requests' })
export class PayoutRequest {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_payout_requests_host_id')
  @Column({ type: 'bigint', unsigned: true })
  host_id: string;

  @Index('idx_payout_requests_booking_id', { unique: true })
  @Column({ type: 'bigint', unsigned: true })
  booking_id: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, comment: 'Tổng thu từ đơn hàng' })
  total_booking_amount: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    comment: 'Phí hoa hồng sàn 7.5% (bằng 1/2 Booking.com)',
  })
  platform_commission: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    comment: 'Số tiền thực chuyển khoản cho Host (sau khi trừ 7.5%)',
  })
  actual_payout_amount: number;

  @Column({
    type: 'enum',
    enum: PayoutStatus,
    default: PayoutStatus.PENDING,
  })
  status: PayoutStatus;

  @Column({ type: 'bigint', unsigned: true, nullable: true, comment: 'Maker tạo lệnh' })
  maker_admin_id: string | null;

  @Column({ type: 'bigint', unsigned: true, nullable: true, comment: 'Checker phê duyệt lệnh' })
  checker_admin_id: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'host_id' })
  host: Relation<User>;

  @OneToOne(() => Booking, (booking) => booking.payout, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Relation<Booking>;
}
