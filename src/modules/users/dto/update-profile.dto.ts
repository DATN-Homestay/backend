import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/**
 * Chỉ cho sửa họ tên. Email, SĐT, vai trò không đổi được qua API này;
 * ảnh đại diện sẽ bổ sung khi có API upload Cloudinary.
 */
export class UpdateProfileDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 100, { message: 'Họ tên phải từ 2 đến 100 ký tự' })
  full_name: string;
}
