import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service.js';
import 'multer';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async uploadSingleImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Không tìm thấy file ảnh đính kèm (field: file)');
    }
    const result = await this.uploadService.uploadFile(file, 'stayai/homestays');
    return {
      statusCode: 200,
      message: 'Upload ảnh lên Cloudinary thành công',
      data: result,
    };
  }

  @Post('images')
  @UseInterceptors(
    FilesInterceptor('files', 100, {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
    }),
  )
  async uploadMultipleImages(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Không tìm thấy danh sách file ảnh đính kèm (field: files)');
    }
    if (files.length > 100) {
      throw new BadRequestException('Mỗi lần tải lên không được vượt quá 100 ảnh');
    }
    const results = await this.uploadService.uploadMultipleFiles(files, 'stayai/homestays');
    return {
      statusCode: 200,
      message: `Đã upload thành công ${results.length} ảnh lên Cloudinary`,
      data: results,
    };
  }
}
