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
import { ClaimRequest } from './claim-request.entity.js';

@Entity({ name: 'verification_logs' })
export class VerificationLog {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_verification_logs_request_id')
  @Column({ type: 'bigint', unsigned: true })
  claim_request_id: string;

  @Column({
    type: 'varchar',
    length: 50,
    comment: 'CCCD_OCR (+40đ), PHONE_OTP (+30đ), GPS_HAVERSINE (+30đ), AI_CLIP_VISION (+40đ)',
  })
  step_name: string;

  @Column({ type: 'int', comment: 'Điểm cộng ở bước này' })
  score_awarded: number;

  @Column({ type: 'json', nullable: true, comment: 'Dữ liệu kết quả chi tiết của thuật toán' })
  detail_json: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => ClaimRequest, (req) => req.logs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'claim_request_id' })
  claim_request: Relation<ClaimRequest>;
}
