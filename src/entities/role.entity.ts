import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  type Relation,
} from 'typeorm';
import { User } from './user.entity.js';

export enum RoleType {
  CUSTOMER = 'CUSTOMER',
  HOST = 'HOST',
  ADMIN = 'ADMIN',
}

@Entity({ name: 'roles' })
export class Role {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @Column({
    type: 'varchar',
    length: 50,
    unique: true,
  })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @ManyToMany(() => User, (user) => user.roles)
  users: Relation<User[]>;
}
