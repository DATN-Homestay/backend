import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  HostVerificationDocument,
  ClaimRequest,
  VerificationLog,
} from './entities/index.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HostVerificationDocument,
      ClaimRequest,
      VerificationLog,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class VerificationModule {}
