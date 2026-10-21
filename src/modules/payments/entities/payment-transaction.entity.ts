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
import { Booking } from '../../bookings/entities/booking.entity.js';

export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

@Entity({ name: 'payment_transactions' })
export class PaymentTransaction {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_payment_transactions_booking_id')
  @Column({ type: 'bigint', unsigned: true })
  booking_id: string;

  @Column({ type: 'varchar', length: 50, default: 'VNPAY' })
  payment_method: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Index('idx_payment_transactions_tx_code')
  @Column({ type: 'varchar', length: 100, nullable: true, comment: 'Mã giao dịch từ VNPay' })
  transaction_code: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true, comment: '00: Thành công' })
  vnp_response_code: string | null;

  @Index('idx_payment_transactions_vnp_txn_ref', { unique: true })
  @Column({
    type: 'varchar',
    length: 40,
    nullable: true,
    comment: 'Mã tham chiếu gửi VNPay (vnp_TxnRef), duy nhất cho từng lần thanh toán, dùng chống xử lý trùng IPN',
  })
  vnp_txn_ref: string | null;

  @Column({ type: 'varchar', length: 14, nullable: true, comment: 'vnp_PayDate yyyyMMddHHmmss, cần khi gọi API hoàn tiền' })
  vnp_pay_date: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  bank_code: string | null;

  @Column({ type: 'json', nullable: true, comment: 'Toàn bộ tham số IPN VNPay gửi về, phục vụ đối soát' })
  ipn_payload: Record<string, string> | null;

  @Column({ type: 'timestamp', nullable: true, comment: 'Hạn của link thanh toán' })
  expires_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  paid_at: Date | null;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => Booking, (booking) => booking.payments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Relation<Booking>;
}
