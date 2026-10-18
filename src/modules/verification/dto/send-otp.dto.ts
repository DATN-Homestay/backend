import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendOtpDto {
  @IsNotEmpty()
  @IsString()
  homestay_id: string;

  @IsOptional()
  @IsString()
  email?: string;
}
