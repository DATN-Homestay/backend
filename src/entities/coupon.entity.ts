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
import { User } from './user.entity.js';

export enum CouponCreatorRole {
  ADMIN = 'ADMIN',
  HOST = 'HOST',
}

export enum CouponSponsor {
  PLATFORM = 'PLATFORM',
  HOST = 'HOST',
}

export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
}

@Entity({ name: 'coupons' })
export class Coupon {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_coupons_code', { unique: true })
  @Column({ type: 'varchar', length: 50, comment: 'Mã voucher: STAYAI100, ANVUI10...' })
  code: string;

  @Column({
    type: 'enum',
    enum: CouponCreatorRole,
    comment: 'ADMIN: Sàn tạo mã toàn hệ thống, HOST: Chủ nhà tự tạo cho phòng mình',
  })
  created_by_role: CouponCreatorRole;

  @Index('idx_coupons_host_id')
  @Column({
    type: 'bigint',
    unsigned: true,
    nullable: true,
    comment: 'NULL nếu là mã của toàn sàn, có ID nếu mã riêng của Host',
  })
  host_id: string | null;

  @Column({
    type: 'enum',
    enum: CouponSponsor,
    comment: 'PLATFORM: Sàn tự bù tiền Marketing, HOST: Trừ vào doanh thu phòng của Host',
  })
  sponsor_by: CouponSponsor;

  @Column({
    type: 'enum',
    enum: DiscountType,
  })
  discount_type: DiscountType;

  @Column({ type: 'decimal', precision: 10, scale: 2, comment: 'Giá trị giảm (% hoặc VNĐ)' })
  discount_value: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0, comment: 'Đơn hàng tối thiểu' })
  min_order_value: number;

  @Column({ type: 'datetime' })
  start_date: Date;

  @Column({ type: 'datetime' })
  end_date: Date;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'host_id' })
  host: Relation<User | null>;
}
