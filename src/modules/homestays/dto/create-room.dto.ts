import { IsNotEmpty, IsString, IsNumber, Min } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @IsNotEmpty({ message: 'Tên loại phòng không được để trống' })
  room_name: string;

  @IsNumber()
  @Min(1, { message: 'Sức chứa tối thiểu là 1 người' })
  capacity: number;

  @IsNumber()
  @Min(50000, { message: 'Giá phòng cơ sở tối thiểu là 50,000 VNĐ' })
  base_price: number;
}
