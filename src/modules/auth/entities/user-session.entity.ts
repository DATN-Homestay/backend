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
import { User } from '../../users/entities/user.entity.js';

export enum SessionRevokeReason {
  LOGOUT = 'LOGOUT',
  REMOTE = 'REMOTE',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  REUSE_DETECTED = 'REUSE_DETECTED',
}

/**
 * Phiên đăng nhập theo thiết bị (REQ-028).
 * Chỉ lưu SHA-256 của refresh token; token được xoay vòng mỗi lần refresh.
 */
@Entity({ name: 'user_sessions' })
export class UserSession {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_user_sessions_user_id')
  @Column({ type: 'bigint', unsigned: true })
  user_id: string;

  @Index('idx_user_sessions_refresh_hash', { unique: true })
  @Column({ type: 'char', length: 64, comment: 'SHA-256 của refresh token hiện tại' })
  refresh_token_hash: string;

  @Index('idx_user_sessions_previous_hash')
  @Column({
    type: 'char',
    length: 64,
    nullable: true,
    comment: 'SHA-256 của refresh token ngay trước đó, dùng phát hiện token bị dùng lại',
  })
  previous_token_hash: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  user_agent: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address: string | null;

  @Column({ type: 'timestamp', comment: 'Hạn của refresh token, gia hạn mỗi lần refresh' })
  expires_at: Date;

  @Column({ type: 'timestamp' })
  last_used_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  revoked_at: Date | null;

  @Column({ type: 'enum', enum: SessionRevokeReason, nullable: true })
  revoke_reason: SessionRevokeReason | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;
}
