import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
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
  /** Đang gọi VNPay Refund API; đã nhận việc nên job khác không xử lý trùng */
  PROCESSING = 'PROCESSING',
}

/** Nguyên nhân phát sinh hoàn tiền */
export enum RefundSource {
  CUSTOMER_CANCEL = 'CUSTOMER_CANCEL',
  HOST_CANCEL = 'HOST_CANCEL',
  ADMIN_CANCEL = 'ADMIN_CANCEL',
  /** Khách thanh toán xong nhưng đơn đã hết hạn/bị hủy và phòng không còn */
  LATE_PAYMENT = 'LATE_PAYMENT',
  OTHER = 'OTHER',
}

@Entity({ name: 'refund_transactions' })
export class RefundTransaction {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_refund_transactions_booking_id')
  @Column({ type: 'bigint', unsigned: true })
  booking_id: string;

  @Column({
    type: 'bigint',
    unsigned: true,
    nullable: true,
    comment: 'Giao dịch thanh toán gốc được hoàn (VNPay hoàn theo từng giao dịch)',
  })
  payment_id: string | null;

  @Column({ type: 'enum', enum: RefundSource, default: RefundSource.OTHER })
  source: RefundSource;

  @Column({ type: 'decimal', precision: 12, scale: 2, comment: 'Số tiền Sàn hoàn lại cho Khách' })
  refund_amount: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, comment: 'Tỷ lệ hoàn trên giá trị đơn (%)' })
  refund_percentage: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0, comment: 'Tiền phạt Host hủy đơn, M3 trừ vào Payout kỳ sau' })
  penalty_amount: number;

  @Index('idx_refund_transactions_status')
  @Column({
    type: 'enum',
    enum: RefundStatus,
    default: RefundStatus.PENDING,
  })
  status: RefundStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @Column({ type: 'int', unsigned: true, default: 0, comment: 'Số lần đã gọi VNPay Refund API' })
  attempts: number;

  @Column({ type: 'varchar', length: 32, nullable: true, comment: 'vnp_RequestId của lần gọi gần nhất' })
  vnp_request_id: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true, comment: 'Mã giao dịch hoàn tiền phía VNPay' })
  vnp_transaction_no: string | null;

  @Column({ type: 'json', nullable: true, comment: 'Phản hồi của VNPay hoặc thông tin hoàn thủ công, phục vụ đối soát' })
  gateway_payload: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 500, nullable: true, comment: 'Lý do thất bại gần nhất' })
  last_error: string | null;

  @Column({ type: 'timestamp', nullable: true })
  processed_at: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => Booking, (booking) => booking.refunds, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Relation<Booking>;
}
