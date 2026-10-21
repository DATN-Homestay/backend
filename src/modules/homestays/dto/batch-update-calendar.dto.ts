import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

export class BatchUpdateCalendarDto {
  @IsString()
  @IsNotEmpty({ message: 'from_date không được để trống' })
  from_date: string;

  @IsString()
  @IsNotEmpty({ message: 'to_date không được để trống' })
  to_date: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsNumber()
  is_available?: number;
}
