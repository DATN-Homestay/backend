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
import { Room } from './room.entity.js';

export enum AiPricingStatus {
  SUGGESTED = 'SUGGESTED',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

@Entity({ name: 'ai_pricing_logs' })
export class AiPricingLog {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_ai_pricing_room_id')
  @Column({ type: 'bigint', unsigned: true })
  room_id: string;

  @Index('idx_ai_pricing_date')
  @Column({ type: 'date', comment: 'Ngày được AI gợi ý định giá' })
  target_date: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    comment: 'Giá niêm yết cơ sở của Host (P_base)',
  })
  base_price: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    comment: 'Giá trung bình của cụm đối thủ tương đồng CompSet lân cận 3-5km (P_market)',
  })
  market_comp_price: number | null;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
    comment: 'Tỷ lệ kín phòng của các homestay đối thủ trong khu vực (Occ %)',
  })
  comp_occupancy_rate: number | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    comment: 'Mức giá do AI đề xuất sau khi áp dụng giới hạn an toàn ±30% (P_suggest)',
  })
  suggested_price: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    comment: 'Mức giá thực tế được áp dụng sau khi Host xác nhận',
  })
  applied_price: number | null;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: 'Lời giải thích của AI (Explainable AI - XAI) bằng tiếng Việt cho chủ nhà',
  })
  ai_explanation_vn: string | null;

  @Index('idx_ai_pricing_status')
  @Column({
    type: 'enum',
    enum: AiPricingStatus,
    default: AiPricingStatus.SUGGESTED,
  })
  status: AiPricingStatus;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => Room, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: Relation<Room>;
}
