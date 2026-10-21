import { IsNotEmpty, IsString, IsOptional, IsNumber } from 'class-validator';

export class UploadRoomImageDto {
  @IsString()
  @IsNotEmpty({ message: 'URL ảnh không được để trống' })
  image_url: string;

  @IsOptional()
  @IsNumber()
  is_primary?: number;

  @IsOptional()
  @IsNumber()
  sort_order?: number;
}
