import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FraudLog } from './entities/index.js';

@Module({
  imports: [TypeOrmModule.forFeature([FraudLog])],
  exports: [TypeOrmModule],
})
export class SecurityModule {}
