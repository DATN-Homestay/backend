import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  type Relation,
} from 'typeorm';
import { Homestay } from './homestay.entity.js';
import { PriceCalendar } from './price-calendar.entity.js';
import { RoomImage } from './room-image.entity.js';
import { Booking } from '../../bookings/entities/booking.entity.js';
import { AiPricingLog } from '../../dynamic-pricing/entities/ai-pricing-log.entity.js';

@Entity({ name: 'rooms' })
export class Room {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_rooms_homestay_id')
  @Column({ type: 'bigint', unsigned: true })
  homestay_id: string;

  @Column({ type: 'varchar', length: 100 })
  room_name: string;

  @Column({ type: 'int', default: 2 })
  capacity: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, comment: 'Giá gốc niêm yết của Host' })
  base_price: number;

  @Column({ type: 'int', nullable: true, comment: 'Diện tích phòng (m²)' })
  area_sqm: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'Thông tin giường' })
  bed_info: string | null;

  @Column({ type: 'text', nullable: true, comment: 'Mô tả chi tiết phòng' })
  description: string | null;

  @Column({ type: 'json', nullable: true, comment: 'Chi tiết tiện nghi phòng (badges, bathroom, views, general, smoking)' })
  room_details_json: {
    badges?: string[];
    bed_rating_text?: string;
    bathroom_amenities?: string[];
    views?: string[];
    room_amenities?: string[];
    smoking_policy?: string;
  } | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => Homestay, (homestay) => homestay.rooms, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'homestay_id' })
  homestay: Relation<Homestay>;

  @OneToMany(() => PriceCalendar, (calendar) => calendar.room, { cascade: true })
  price_calendars: Relation<PriceCalendar[]>;

  @OneToMany(() => RoomImage, (image) => image.room, { cascade: true })
  images: Relation<RoomImage[]>;

  @OneToMany(() => Booking, (booking) => booking.room)
  bookings: Relation<Booking[]>;

  @OneToMany(() => AiPricingLog, (log) => log.room)
  ai_pricing_logs: Relation<AiPricingLog[]>;
}
