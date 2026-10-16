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
import { Conversation } from './conversation.entity.js';
import { User } from './user.entity.js';

export enum SenderRole {
  CUSTOMER = 'CUSTOMER',
  HOST = 'HOST',
}

@Entity({ name: 'messages' })
export class Message {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_messages_conversation_id')
  @Column({ type: 'bigint', unsigned: true })
  conversation_id: string;

  @Index('idx_messages_sender_id')
  @Column({ type: 'bigint', unsigned: true })
  sender_id: string;

  @Column({
    type: 'enum',
    enum: SenderRole,
  })
  sender_role: SenderRole;

  @Column({ type: 'text', comment: 'Nội dung tin nhắn trao đổi' })
  content: string;

  @Column({ type: 'tinyint', default: 0, comment: '1: Đã đọc, 0: Chưa đọc' })
  is_read: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => Conversation, (conv) => conv.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Relation<Conversation>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender: Relation<User>;
}
