import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Index,
  type Relation,
} from 'typeorm';
import { Booking } from './booking.entity.js';
import { User } from './user.entity.js';
import { Homestay } from './homestay.entity.js';

export enum ReviewStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity({ name: 'reviews' })
export class Review {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_reviews_booking_id', { unique: true })
  @Column({
    type: 'bigint',
    unsigned: true,
    comment: 'Chỉ đơn COMPLETED (check-in & check-out thành công) mới được đánh giá',
  })
  booking_id: string;

  @Index('idx_reviews_customer_id')
  @Column({ type: 'bigint', unsigned: true })
  customer_id: string;

  @Index('idx_reviews_homestay_id')
  @Column({ type: 'bigint', unsigned: true })
  homestay_id: string;

  @Column({ type: 'tinyint', comment: 'Điểm tổng quan từ 1 đến 5 sao' })
  rating_overall: number;

  @Column({ type: 'tinyint', comment: 'Khía cạnh ABSA: Vệ sinh & Tiện nghi (1-5 sao)' })
  cleanliness_rating: number;

  @Column({ type: 'tinyint', comment: 'Khía cạnh ABSA: Thái độ phục vụ của Host (1-5 sao)' })
  service_rating: number;

  @Column({ type: 'tinyint', comment: 'Khía cạnh ABSA: Vị trí & Cảnh quan (1-5 sao)' })
  location_rating: number;

  @Column({ type: 'tinyint', comment: 'Khía cạnh ABSA: Độ tương xứng giá tiền (1-5 sao)' })
  value_rating: number;

  @Column({ type: 'text', nullable: true, comment: 'Bình luận chi tiết của khách' })
  comment: string | null;

  @Column({ type: 'json', nullable: true, comment: 'Danh sách URL ảnh chụp thực tế lúc ở chống review ảo' })
  photos_json: string[] | null;

  @Column({
    type: 'tinyint',
    default: 1,
    comment: '1: Xác thực đã lưu trú thực tế tại Homestay (Verified Stay)',
  })
  is_verified_stay: number;

  @Column({
    type: 'enum',
    enum: ReviewStatus,
    default: ReviewStatus.APPROVED,
  })
  status: ReviewStatus;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @OneToOne(() => Booking, (booking) => booking.review, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Relation<Booking>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Relation<User>;

  @ManyToOne(() => Homestay, (homestay) => homestay.reviews, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'homestay_id' })
  homestay: Relation<Homestay>;
}
