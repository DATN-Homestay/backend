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
import { User } from './user.entity.js';
import { Room } from './room.entity.js';
import { Review } from './review.entity.js';
import { ReviewAbsaMetric } from './review-absa-metric.entity.js';

export enum CancellationPolicy {
  FLEXIBLE = 'FLEXIBLE',
  MODERATE = 'MODERATE',
  STRICT = 'STRICT',
  NON_REFUNDABLE = 'NON_REFUNDABLE',
}

export enum HomestayStatus {
  DRAFT = 'DRAFT',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  BANNED = 'BANNED',
}

@Entity({ name: 'homestays' })
export class Homestay {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  // 1 Chủ homestay có thể sở hữu nhiều homestay (ManyToOne với User)
  @Index('idx_homestays_host_id')
  @Column({ type: 'bigint', unsigned: true, nullable: true })
  host_id: string | null;

  @Index('idx_homestays_name')
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 500 })
  address: string;

  @Index('idx_homestays_city')
  @Column({ type: 'varchar', length: 100 })
  city: string;

  @Index('idx_homestays_location')
  @Column({ type: 'decimal', precision: 10, scale: 8, comment: 'Vĩ độ GPS Haversine' })
  latitude: number;

  @Column({ type: 'decimal', precision: 11, scale: 8, comment: 'Kinh độ GPS Haversine' })
  longitude: number;

  @Column({ type: 'varchar', length: 20, nullable: true, comment: 'SĐT làm giàu từ Google Maps' })
  crawled_phone: string | null;

  @Index('idx_homestays_source_url', { unique: true })
  @Column({ type: 'varchar', length: 500, nullable: true, comment: 'ID hoặc Link gốc từ RapidAPI' })
  source_url: string | null;

  @Index('idx_homestays_is_claimed')
  @Column({ type: 'tinyint', default: 0, comment: '0: UNCLAIMED (hàng từ RapidAPI), 1: CLAIMED (chính chủ)' })
  is_claimed: number;

  @Index('idx_homestays_last_price_synced_at')
  @Column({
    type: 'timestamp',
    nullable: true,
    comment: 'Thời điểm đồng bộ giá đối thủ lần cuối từ RapidAPI (Cache TTL 6 tiếng)',
  })
  last_price_synced_at: Date | null;

  // Điểm số sao trung bình và số lượng đánh giá tích lũy (Cực kỳ tối ưu cho tìm kiếm, không phải tính lại AVG())
  @Column({
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: 0.0,
    comment: 'Điểm đánh giá sao trung bình (1.00 - 5.00 sao)',
  })
  average_rating: number;

  @Column({
    type: 'int',
    default: 0,
    comment: 'Tổng số lượt khách đã đánh giá',
  })
  total_reviews: number;

  @Column({
    type: 'enum',
    enum: CancellationPolicy,
    default: CancellationPolicy.FLEXIBLE,
  })
  cancellation_policy: CancellationPolicy;

  @Column({ type: 'json', nullable: true, comment: 'Tiện nghi tĩnh: Wifi, Bếp BBQ, View đồi...' })
  amenities_json: Record<string, any> | null;

  @Column({ type: 'json', nullable: true, comment: 'Nội quy phòng: Giờ check-in, thú cưng...' })
  rules_json: Record<string, any> | null;

  @Column({
    type: 'enum',
    enum: HomestayStatus,
    default: HomestayStatus.ACTIVE,
  })
  status: HomestayStatus;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  // Quan hệ 1 Chủ nhà sở hữu Nhiều Homestay
  @ManyToOne(() => User, (user) => user.homestays, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'host_id' })
  host: Relation<User | null>;

  @OneToMany(() => Room, (room) => room.homestay, { cascade: true })
  rooms: Relation<Room[]>;

  @OneToMany(() => Review, (review) => review.homestay)
  reviews: Relation<Review[]>;

  // AI Service: Tóm tắt đánh giá và biểu đồ Radar ABSA
  @OneToOne(() => ReviewAbsaMetric, (absa) => absa.homestay, { cascade: true })
  absa_metric: Relation<ReviewAbsaMetric>;
}
