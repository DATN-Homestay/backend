import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';
import { VerificationService } from './verification.service.js';
import { UploadService } from '../upload/upload.service.js';
import { VerifyCccdDto } from './dto/verify-cccd.dto.js';
import { SendOtpDto } from './dto/send-otp.dto.js';
import { CheckOtpDto } from './dto/check-otp.dto.js';
import { VerifyGpsDto } from './dto/verify-gps.dto.js';
import { VerifyLiveImageDto } from './dto/verify-live-image.dto.js';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RoleType } from '../users/entities/role.entity.js';

@Controller('host/verify')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.HOST, RoleType.ADMIN)
export class VerificationController {
  constructor(
    private readonly verificationService: VerificationService,
    private readonly uploadService: UploadService,
  ) {}

  private getHostId(req: any): string {
    return String(req.user?.id || req.user?.sub || (req.headers['x-user-id'] as string) || '1');
  }

  /**
   * Tải ảnh CCCD (Mặt trước / Mặt sau) lên máy chủ lưu trữ an toàn
   */
  @Post('upload-cccd')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // Tối đa 10MB
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
          return cb(new BadRequestException('Chỉ chấp nhận file ảnh định dạng JPG, PNG, WEBP!'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadCccdImage(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file ảnh CCCD cần tải lên!');
    }
    const uploadDir = path.resolve(process.cwd(), 'uploads', 'cccd');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const ext = path.extname(file.originalname) || '.jpg';
    const fileName = `cccd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext}`;
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, file.buffer);

    let finalImageUrl = `/api/v1/host/verify/files/${fileName}`;
    try {
      if (process.env.CLOUDINARY_CLOUD_NAME) {
        const cloudResult = await this.uploadService.uploadFile(file, 'stayai/cccd');
        if (cloudResult?.url) {
          finalImageUrl = cloudResult.url;
        }
      }
    } catch {
      // Giữ local file url nếu Cloudinary lỗi
    }

    return {
      statusCode: 200,
      message: 'Tải ảnh CCCD thành công',
      data: {
        file_name: fileName,
        image_url: finalImageUrl,
      },
    };
  }

  /**
   * BƯỚC 1: CCCD eKYC & Mã hóa AES-256 (+40đ) - Kiểm tra OCR & Anti-spoofing
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
   * Quét thử OCR và phân tích chống giả trên ảnh CCCD (Mặt trước / Mặt sau)
   */
  @Post('cccd/scan-ocr')
  async scanCccdOcr(
    @Body()
    body: {
      image_url?: string;
      image_base64?: string;
      front_image_url?: string;
      front_image_base64?: string;
      back_image_url?: string;
      back_image_base64?: string;
    },
  ) {
    const front =
      body?.front_image_base64 ||
      body?.front_image_url ||
      body?.image_base64 ||
      body?.image_url;
    const back = body?.back_image_base64 || body?.back_image_url;

    if (!front) {
      throw new BadRequestException('Vui lòng cung cấp ảnh mặt trước CCCD để quét OCR');
    }
    const data = await this.verificationService.scanCccdOcr(front, back);
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

/**
 * Phục vụ xem file ảnh CCCD tĩnh không chặn token guard (để thẻ img/browser tải được)
 */
@Controller('host/verify/files')
export class VerificationFilesController {
  @Get(':filename')
  async getCccdFile(@Param('filename') filename: string, @Res() res: any) {
    const safeFilename = path.basename(filename);
    const filePath = path.resolve(process.cwd(), 'uploads', 'cccd', safeFilename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Không tìm thấy file ảnh' });
    }
    return res.sendFile(filePath);
  }
}
