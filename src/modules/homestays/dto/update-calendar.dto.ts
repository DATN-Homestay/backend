import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

export class UpdateCalendarDto {
  @IsString()
  @IsNotEmpty({ message: 'Ngày không được để trống (YYYY-MM-DD)' })
  date: string;

  @IsNumber()
  @IsNotEmpty({ message: 'Giá phòng không được để trống' })
  price: number;

  @IsOptional()
  @IsNumber()
  is_available?: number;
}
