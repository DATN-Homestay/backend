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
} from 'typeorm';
import { User } from './user.entity.js';
import { Homestay } from './homestay.entity.js';
import { VerificationLog } from './verification-log.entity.js';

export enum ClaimStatus {
  SUBMITTED = 'SUBMITTED',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity({ name: 'claim_requests' })
export class ClaimRequest {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_claim_requests_host_id')
  @Column({ type: 'bigint', unsigned: true })
  host_id: string;

  @Index('idx_claim_requests_homestay_id')
  @Column({ type: 'bigint', unsigned: true })
  homestay_id: string;

  @Column({
    type: 'enum',
    enum: ClaimStatus,
    default: ClaimStatus.SUBMITTED,
  })
  status: ClaimStatus;

  // 4 Tầng Xác Thực AI Chính Chủ Homestay (Tổng thang điểm: 140 điểm, Đạt >= 100đ sẽ Tự Động Duyệt)
  @Column({ type: 'int', default: 0, comment: 'Tầng 1: AI OCR CCCD & Khớp thông tin cá nhân (+40đ)' })
  cccd_score: number;

  @Column({ type: 'int', default: 0, comment: 'Tầng 2: Xác thực OTP qua số điện thoại chính chủ (+30đ)' })
  phone_otp_score: number;

  @Column({ type: 'int', default: 0, comment: 'Tầng 3: GPS Haversine định vị trực tiếp tại Homestay (+30đ)' })
  gps_score: number;

  @Column({ type: 'int', default: 0, comment: 'Tầng 4: AI CLIP ViT-B/32 so sánh ảnh hiện trường & ảnh thương mại (+40đ)' })
  live_vision_score: number;

  @Column({ type: 'int', default: 0, comment: 'Tổng điểm Trust Score = cccd + otp + gps + live_vision (Thang 140đ)' })
  trust_score: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
    comment: 'Khoảng cách mét thực tế đo được bằng Haversine giữa Host và Homestay',
  })
  haversine_distance_m: number | null;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 4,
    nullable: true,
    comment: 'Độ tương đồng Cosine Similarity giữa ảnh Live Camera và ảnh Album thương mại',
  })
  vision_similarity: number | null;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: 'URL ảnh chụp thực tế tại chỗ qua Live Camera (chống tải ảnh mạng)',
  })
  live_photo_url: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  rejection_reason: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'host_id' })
  host: User;

  @ManyToOne(() => Homestay, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'homestay_id' })
  homestay: Homestay;

  @OneToMany(() => VerificationLog, (log) => log.claim_request, { cascade: true })
  logs: VerificationLog[];
}
