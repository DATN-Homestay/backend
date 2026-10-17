import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
  ManyToMany,
  JoinTable,
  type Relation,
} from 'typeorm';
import { Role } from './role.entity.js';
import { HostVerificationDocument } from '../../verification/entities/host-verification-document.entity.js';
import { Homestay } from '../../homestays/entities/homestay.entity.js';
import { Booking } from '../../bookings/entities/booking.entity.js';

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  BANNED = 'BANNED',
}

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 191, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  password_hash: string;

  @Column({ type: 'varchar', length: 100 })
  full_name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone_number: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatar_url: string | null;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @Column({
    type: 'int',
    unsigned: true,
    default: 0,
    comment: 'Số lần đăng nhập sai liên tiếp (khóa tạm khi đủ 5 lần)',
  })
  failed_login_count: number;

  @Column({
    type: 'timestamp',
    nullable: true,
    comment: 'Khóa đăng nhập tạm thời đến thời điểm này',
  })
  locked_until: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @ManyToMany(() => Role, (role) => role.users, { cascade: true })
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles: Relation<Role[]>;

  @OneToOne(
    () => HostVerificationDocument,
    (verification) => verification.host,
    { cascade: true },
  )
  verification_document: Relation<HostVerificationDocument>;

  @OneToMany(() => Homestay, (homestay) => homestay.host)
  homestays: Relation<Homestay[]>;

  @OneToMany(() => Booking, (booking) => booking.customer)
  bookings: Relation<Booking[]>;
}
