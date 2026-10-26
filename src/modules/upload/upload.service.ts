import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import 'multer';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME') || process.env.CLOUDINARY_CLOUD_NAME,
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY') || process.env.CLOUDINARY_API_KEY,
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET') || process.env.CLOUDINARY_API_SECRET,
    });
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'stayai/homestays',
  ): Promise<{ url: string; public_id: string; width?: number; height?: number }> {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file ảnh để tải lên');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Chỉ cho phép tải lên định dạng file ảnh (JPEG, PNG, WEBP, v.v.)');
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
        },
        (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
          if (error || !result) {
            this.logger.error('Lỗi khi tải ảnh lên Cloudinary:', error);
            return reject(new BadRequestException(`Lỗi upload Cloudinary: ${error?.message || 'Không xác định'}`));
          }
          resolve({
            url: result.secure_url,
            public_id: result.public_id,
            width: result.width,
            height: result.height,
          });
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  async uploadMultipleFiles(
    files: Express.Multer.File[],
    folder: string = 'stayai/homestays',
  ): Promise<Array<{ url: string; public_id: string; width?: number; height?: number }>> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Không có file ảnh nào được chọn');
    }
    return await Promise.all(files.map((file) => this.uploadFile(file, folder)));
  }
}
