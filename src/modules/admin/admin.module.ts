import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { PayoutRequest } from '../payments/entities/payout-request.entity.js';
import { ClaimRequest } from '../verification/entities/claim-request.entity.js';
import { HostVerificationDocument } from '../verification/entities/host-verification-document.entity.js';
import { Homestay } from '../homestays/entities/homestay.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PayoutRequest,
      ClaimRequest,
      HostVerificationDocument,
      Homestay,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
