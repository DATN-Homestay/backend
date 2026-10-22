import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  HostVerificationDocument,
  ClaimRequest,
  VerificationLog,
} from './entities/index.js';
import { Homestay } from '../homestays/entities/homestay.entity.js';
import { User } from '../users/entities/user.entity.js';
import { VerificationService } from './verification.service.js';
import { VerificationController } from './verification.controller.js';
import { CccdOcrService } from './cccd-ocr.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HostVerificationDocument,
      ClaimRequest,
      VerificationLog,
      Homestay,
      User,
    ]),
  ],
  controllers: [VerificationController],
  providers: [VerificationService, CccdOcrService],
  exports: [VerificationService, CccdOcrService, TypeOrmModule],
})
export class VerificationModule {}
