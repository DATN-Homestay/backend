import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Room } from './room.entity.js';

@Entity({ name: 'room_images' })
export class RoomImage {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_room_images_room_id')
  @Column({ type: 'bigint', unsigned: true })
  room_id: string;

  @Column({ type: 'varchar', length: 500, comment: 'Cloudinary Public CDN URL' })
  image_url: string;

  @Column({ type: 'tinyint', default: 0, comment: '1: Ảnh đại diện cover, 0: Ảnh phụ' })
  is_primary: number;

  @Column({ type: 'int', default: 0, comment: 'Thứ tự hiển thị' })
  sort_order: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => Room, (room) => room.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: Room;
}
