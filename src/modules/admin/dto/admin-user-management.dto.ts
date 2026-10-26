import {
  IsOptional,
  IsString,
  IsEnum,
  IsArray,
  IsNotEmpty,
  IsEmail,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from './admin-query.dto.js';
import { UserStatus } from '../../users/entities/user.entity.js';
import { RoleType } from '../../users/entities/role.entity.js';

// ─── Query / Filter ────────────────────────────────────────────────

export class AdminListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsEnum(RoleType)
  role?: RoleType;
}

// ─── Update trạng thái user ────────────────────────────────────────

export class AdminUpdateUserStatusDto {
  @IsEnum(UserStatus, {
    message: 'Trạng thái phải là ACTIVE, SUSPENDED hoặc BANNED',
  })
  status: UserStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}

// ─── Update role cho user ──────────────────────────────────────────

export class AdminUpdateUserRolesDto {
  @IsArray()
  @IsEnum(RoleType, { each: true, message: 'Mỗi role phải là CUSTOMER, HOST hoặc ADMIN' })
  roles: RoleType[];
}

// ─── Admin tạo user mới ────────────────────────────────────────────

export class AdminCreateUserDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải ít nhất 6 ký tự' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  full_name: string;

  @IsOptional()
  @IsString()
  phone_number?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(RoleType, { each: true })
  roles?: RoleType[];
}
