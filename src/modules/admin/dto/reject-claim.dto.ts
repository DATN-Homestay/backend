import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class RejectClaimDto {
  @IsString()
  @IsNotEmpty({ message: 'rejection_reason không được để trống' })
  @MinLength(10, { message: 'Lý do từ chối phải có ít nhất 10 ký tự' })
  rejection_reason: string;
}
