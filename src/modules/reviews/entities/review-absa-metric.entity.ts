import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
  type Relation,
} from 'typeorm';
import { Homestay } from '../../homestays/entities/homestay.entity.js';

@Entity({ name: 'review_absa_metrics' })
export class ReviewAbsaMetric {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_absa_homestay_id', { unique: true })
  @Column({
    type: 'bigint',
    unsigned: true,
    comment: 'Khóa ngoại 1-1 với Homestay (mỗi homestay có 1 bản ghi tổng hợp radar ABSA)',
  })
  homestay_id: string;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: 5.0,
    comment: 'Điểm khía cạnh Vệ sinh (1.00 - 5.00)',
  })
  cleanliness_score: number;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: 5.0,
    comment: 'Điểm khía cạnh Dịch vụ & Thái độ phục vụ của Host (1.00 - 5.00)',
  })
  service_score: number;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: 5.0,
    comment: 'Điểm khía cạnh Vị trí & Cảnh quan (1.00 - 5.00)',
  })
  location_score: number;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: 5.0,
    comment: 'Điểm khía cạnh Tương xứng giá tiền (Value for Money) (1.00 - 5.00)',
  })
  value_score: number;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: 5.0,
    comment: 'Điểm khía cạnh Tiếng ồn & Yên tĩnh nghỉ dưỡng (1.00 - 5.00)',
  })
  noise_score: number;

  @Column({
    type: 'text',
    nullable: true,
    comment: 'Đoạn văn 2-3 câu do AI tóm tắt ngắn gọn ưu và nhược điểm thực tế để hiển thị tức thì (<0.1s)',
  })
  ai_summary_vn: string | null;

  @Column({
    type: 'json',
    nullable: true,
    comment: 'Phân bố cảm xúc: { positive_percent: 88, neutral_percent: 8, negative_percent: 4 }',
  })
  sentiment_distribution_json: Record<string, any> | null;

  @Column({
    type: 'int',
    default: 0,
    comment: 'Số lượng review đã được AI phân tích trong mẻ gần nhất',
  })
  processed_reviews_count: number;

  @Column({
    type: 'timestamp',
    nullable: true,
    comment: 'Thời điểm AI chạy batch ABSA gần nhất',
  })
  last_analyzed_at: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @OneToOne(() => Homestay, (homestay) => homestay.absa_metric, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'homestay_id' })
  homestay: Relation<Homestay>;
}
