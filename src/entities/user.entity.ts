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
} from 'typeorm';
import { Role } from './role.entity.js';
import { HostVerificationDocument } from './host-verification-document.entity.js';
import { Homestay } from './homestay.entity.js';
import { Booking } from './booking.entity.js';

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
  roles: Role[];

  @OneToOne(
    () => HostVerificationDocument,
    (verification) => verification.host,
    { cascade: true },
  )
  verification_document: HostVerificationDocument;

  @OneToMany(() => Homestay, (homestay) => homestay.host)
  homestays: Homestay[];

  @OneToMany(() => Booking, (booking) => booking.customer)
  bookings: Booking[];
}
