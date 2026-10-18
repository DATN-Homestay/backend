import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyCccdDto {
  @IsNotEmpty()
  @IsString()
  homestay_id: string;

  @IsNotEmpty()
  @IsString()
  front_image_url: string;

  @IsNotEmpty()
  @IsString()
  back_image_url: string;

  @IsNotEmpty()
  @IsString()
  cccd_number: string;

  @IsNotEmpty()
  @IsString()
  full_name: string;

  @IsNotEmpty()
  @IsString()
  bank_account_number: string;

  @IsNotEmpty()
  @IsString()
  bank_name: string;

  @IsNotEmpty()
  @IsString()
  bank_account_holder_name: string;
}
