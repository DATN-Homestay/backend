import { IsOptional, IsString, IsNumber, Min } from 'class-validator';

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  room_name?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsNumber()
  @Min(50000)
  base_price?: number;

  @IsOptional()
  images?: string[];
}
