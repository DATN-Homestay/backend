import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { RoleType } from '../../users/entities/role.entity.js';

/** Vai trò được phép tự đăng ký. ADMIN chỉ do Super Admin cấp. */
export const SELF_REGISTER_ROLES = [RoleType.CUSTOMER, RoleType.HOST] as const;
export type SelfRegisterRole = (typeof SELF_REGISTER_ROLES)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @MaxLength(191)
  email: string;

  @IsString()
  @Length(8, 64, { message: 'Mật khẩu phải từ 8 đến 64 ký tự' })
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Mật khẩu phải có chữ hoa, chữ thường và chữ số',
  })
  password: string;

  @Transform(trim)
  @IsString()
  @Length(2, 100, { message: 'Họ tên phải từ 2 đến 100 ký tự' })
  full_name: string;

  @Transform(trim)
  @IsOptional()
  @Matches(/^0\d{9}$/, { message: 'Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0' })
  phone_number?: string;

  @IsOptional()
  @IsIn(SELF_REGISTER_ROLES, { message: 'Vai trò chỉ được là CUSTOMER hoặc HOST' })
  role?: SelfRegisterRole;
}
