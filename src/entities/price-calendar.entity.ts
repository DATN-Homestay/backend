import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Room } from './room.entity.js';

@Entity({ name: 'price_calendars' })
@Unique('uq_room_date', ['room_id', 'date'])
export class PriceCalendar {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_price_calendars_room_id')
  @Column({ type: 'bigint', unsigned: true })
  room_id: string;

  @Index('idx_price_calendars_date')
  @Column({ type: 'date', comment: 'Ngày áp dụng giá' })
  date: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, comment: 'Giá bán thực tế của ngày' })
  price: number;

  @Column({ type: 'tinyint', default: 1, comment: '1: Còn phòng, 0: Đã kín' })
  is_available: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    comment: 'Giá trung bình thị trường P_market của 5-10 đối thủ trong bán kính 3-5km',
  })
  comp_set_avg_price: number | null;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
    comment: 'Tỷ lệ kín phòng khu vực Occ (%) từ RapidAPI',
  })
  comp_set_occupancy_rate: number | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    comment: 'Giá AI đề xuất theo thuật toán Dynamic Pricing',
  })
  ai_suggested_price: number | null;

  @Column({
    type: 'tinyint',
    default: 0,
    comment: '1: Host đã bấm Áp dụng, 0: Giữ nguyên giá gốc',
  })
  is_ai_applied: number;

  @Column({
    type: 'timestamp',
    nullable: true,
    comment: 'Khóa tạm thời 15 phút khi khách đang thanh toán VNPay',
  })
  locked_until: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => Room, (room) => room.price_calendars, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: Room;
}
