import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  type Relation,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { Homestay } from '../../homestays/entities/homestay.entity.js';
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
  customer: Relation<User>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'host_id' })
  host: Relation<User>;

  @ManyToOne(() => Homestay, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'homestay_id' })
  homestay: Relation<Homestay>;

  @OneToMany(() => Message, (message) => message.conversation, { cascade: true })
  messages: Relation<Message[]>;
}
