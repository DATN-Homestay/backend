import { IsNotEmpty, IsString, Length, Matches, MaxLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập mật khẩu hiện tại' })
  @MaxLength(64)
  current_password: string;

  // Cùng quy tắc với đăng ký (AU-02)
  @IsString()
  @Length(8, 64, { message: 'Mật khẩu mới phải từ 8 đến 64 ký tự' })
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Mật khẩu mới phải có chữ hoa, chữ thường và chữ số',
  })
  new_password: string;
}
