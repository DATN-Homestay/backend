import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum FraudTargetType {
  USER = 'USER',
  BOOKING = 'BOOKING',
  REVIEW = 'REVIEW',
}

@Entity({ name: 'fraud_logs' })
export class FraudLog {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_fraud_target_type')
  @Column({
    type: 'enum',
    enum: FraudTargetType,
    comment: 'Loại thực thể bị thuật toán phát hiện bất thường',
  })
  target_type: FraudTargetType;

  @Index('idx_fraud_target_id')
  @Column({
    type: 'bigint',
    unsigned: true,
    comment: 'ID của đối tượng (user_id, booking_id hoặc review_id)',
  })
  target_id: string;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 4,
    comment: 'Điểm dị biệt do Isolation Forest tính toán (-1.0000 đến 0.0000). Càng âm càng nguy hiểm',
  })
  anomaly_score: number;

  @Column({
    type: 'varchar',
    length: 255,
    comment: 'Lý do AI gắn cờ (Spam review cùng IP, Giữ phòng liên tục rồi hủy, Đổi thiết bị bất thường...)',
  })
  detection_reason: string;

  @Column({
    type: 'json',
    nullable: true,
    comment: 'Vector đặc trưng hành vi đầu vào đưa vào mô hình học máy',
  })
  feature_vector_json: Record<string, any> | null;

  @Index('idx_fraud_is_resolved')
  @Column({
    type: 'tinyint',
    default: 0,
    comment: '0: Cảnh báo chưa xử lý (Cần Admin review), 1: Đã xác minh hoặc đã gỡ cờ',
  })
  is_resolved: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
