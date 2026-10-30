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
import { User } from '../../users/entities/user.entity.js';

export enum VerificationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity({ name: 'host_verification_documents' })
export class HostVerificationDocument {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, unique: true })
  host_id: string;

  @Column({ type: 'text', comment: 'Mã hóa AES-256-CBC số CCCD' })
  cccd_number_encrypted: string;

  @Column({ type: 'mediumtext', nullable: true, comment: 'Cloudinary private signed URL hoặc Base64' })
  cccd_front_image: string;

  @Column({ type: 'mediumtext', nullable: true, comment: 'Cloudinary private signed URL hoặc Base64' })
  cccd_back_image: string;

  @Column({ type: 'text', comment: 'Mã hóa AES-256-CBC STK Ngân hàng' })
  bank_account_number_encrypted: string;

  @Column({ type: 'varchar', length: 100 })
  bank_name: string;

  @Column({ type: 'varchar', length: 100, comment: 'Tên chủ tài khoản ngân hàng' })
  bank_account_holder_name: string;

  @Index('idx_cccd_hash', { unique: true })
  @Column({ type: 'varchar', length: 64, comment: 'SHA-256 hash của số CCCD chống trùng lặp' })
  cccd_hash: string;

  @Column({
    type: 'enum',
    enum: VerificationStatus,
    default: VerificationStatus.PENDING,
  })
  status: VerificationStatus;

  @Column({ type: 'int', default: 0, comment: 'Điểm Trust Score (Thang 140 điểm)' })
  verification_score: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @OneToOne(() => User, (user) => user.verification_document)
  @JoinColumn({ name: 'host_id' })
  host: Relation<User>;
}
