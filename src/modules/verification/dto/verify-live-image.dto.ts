import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyLiveImageDto {
  @IsNotEmpty()
  @IsString()
  homestay_id: string;

  @IsNotEmpty()
  @IsString()
  live_image_url: string;
}
