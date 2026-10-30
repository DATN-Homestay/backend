import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class RejectPayoutDto {
  @IsString()
  @IsNotEmpty({ message: 'reason không được để trống' })
  @MinLength(10, { message: 'Lý do từ chối phải có ít nhất 10 ký tự' })
  reason: string;
}
