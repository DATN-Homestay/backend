import { IsString, IsOptional, IsUrl } from 'class-validator';

export class ApprovePayoutDto {
  @IsUrl({}, { message: 'receipt_image_url phải là URL hợp lệ' })
  receipt_image_url: string;

  @IsOptional()
  @IsString()
  note?: string;
}
