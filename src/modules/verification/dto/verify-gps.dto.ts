import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class VerifyGpsDto {
  @IsNotEmpty()
  @IsString()
  homestay_id: string;

  @IsNotEmpty()
  @IsNumber()
  latitude: number;

  @IsNotEmpty()
  @IsNumber()
  longitude: number;
}
