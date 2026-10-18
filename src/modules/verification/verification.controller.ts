import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
} from '@nestjs/common';
import { VerificationService } from './verification.service.js';
import { VerifyCccdDto } from './dto/verify-cccd.dto.js';
import { SendOtpDto } from './dto/send-otp.dto.js';
import { CheckOtpDto } from './dto/check-otp.dto.js';
import { VerifyGpsDto } from './dto/verify-gps.dto.js';
import { VerifyLiveImageDto } from './dto/verify-live-image.dto.js';

@Controller('host/verify')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  private getHostId(req: any): string {
    return req.user?.id || (req.headers['x-user-id'] as string) || '1';
  }

  /**
   * BƯỚC 1: CCCD eKYC & Mã hóa AES-256 (+40đ)
   */
  @Post('cccd')
  async verifyCccd(@Req() req: any, @Body() dto: VerifyCccdDto) {
    const hostId = this.getHostId(req);
    const data = await this.verificationService.verifyCccd(hostId, dto);
    return {
      statusCode: 200,
      data,
    };
  }

  /**
   * BƯỚC 2A: Gửi mã OTP về SĐT chủ nhà
   */
  @Post('send-otp')
  async sendOtp(@Req() req: any, @Body() dto: SendOtpDto) {
    const hostId = this.getHostId(req);
    const data = await this.verificationService.sendOtp(hostId, dto);
    return {
      statusCode: 200,
      data,
    };
  }

  /**
   * BƯỚC 2B: Xác thực OTP qua số điện thoại (+30đ)
   */
  @Post('check-otp')
  async checkOtp(@Req() req: any, @Body() dto: CheckOtpDto) {
    const hostId = this.getHostId(req);
    const data = await this.verificationService.checkOtp(hostId, dto);
    return {
      statusCode: 200,
      data,
    };
  }

  /**
   * BƯỚC 3: GPS Haversine định vị trực tiếp tại Homestay (+30đ)
   */
  @Post('gps')
  async verifyGps(@Req() req: any, @Body() dto: VerifyGpsDto) {
    const hostId = this.getHostId(req);
    const data = await this.verificationService.verifyGps(hostId, dto);
    return {
      statusCode: 200,
      data,
    };
  }

  /**
   * BƯỚC 4: AI CLIP ViT-B/32 so sánh ảnh hiện trường & ảnh thương mại (+40đ)
   */
  @Post('live-image')
  async verifyLiveImage(@Req() req: any, @Body() dto: VerifyLiveImageDto) {
    const hostId = this.getHostId(req);
    const data = await this.verificationService.verifyLiveImage(hostId, dto);
    return {
      statusCode: 200,
      data,
    };
  }

  /**
   * Lấy tiến độ và trạng thái chi tiết của 4 lớp xác thực
   */
  @Get('status/:homestayId')
  async getStatus(@Req() req: any, @Param('homestayId') homestayId: string) {
    const hostId = this.getHostId(req);
    const data = await this.verificationService.getVerificationStatus(hostId, homestayId);
    return {
      statusCode: 200,
      data,
    };
  }
}
