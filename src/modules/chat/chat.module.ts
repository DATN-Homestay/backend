import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation, Message } from './entities/index.js';

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Message])],
  exports: [TypeOrmModule],
})
export class ChatModule {}
