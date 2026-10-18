import { IsNotEmpty, IsString } from 'class-validator';

export class CheckOtpDto {
  @IsNotEmpty()
  @IsString()
  homestay_id: string;

  @IsNotEmpty()
  @IsString()
  otp_code: string;
}
