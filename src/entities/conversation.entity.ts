import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity.js';
import { Homestay } from './homestay.entity.js';
import { Message } from './message.entity.js';

@Entity({ name: 'conversations' })
export class Conversation {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_conversations_customer_id')
  @Column({ type: 'bigint', unsigned: true })
  customer_id: string;

  @Index('idx_conversations_host_id')
  @Column({ type: 'bigint', unsigned: true })
  host_id: string;

  @Index('idx_conversations_homestay_id')
  @Column({ type: 'bigint', unsigned: true })
  homestay_id: string;

  @Column({
    type: 'timestamp',
    nullable: true,
    comment: 'Thời điểm tin nhắn cuối cùng gửi trong hội thoại',
  })
  last_message_at: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'host_id' })
  host: User;

  @ManyToOne(() => Homestay, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'homestay_id' })
  homestay: Homestay;

  @OneToMany(() => Message, (message) => message.conversation, { cascade: true })
  messages: Message[];
}
