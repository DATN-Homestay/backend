import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { databaseConfigAsync } from './config/database.config.js';

// Các module chia việc cho 3 thành viên
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { HomestaysModule } from './modules/homestays/homestays.module.js';
import { VerificationModule } from './modules/verification/verification.module.js';
import { BookingsModule } from './modules/bookings/bookings.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { DynamicPricingModule } from './modules/dynamic-pricing/dynamic-pricing.module.js';
import { ReviewsModule } from './modules/reviews/reviews.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { CouponsModule } from './modules/coupons/coupons.module.js';
import { SecurityModule } from './modules/security/security.module.js';
import { AdminModule } from './modules/admin/admin.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRootAsync(databaseConfigAsync),
    AuthModule,
    UsersModule,
    HomestaysModule,
    VerificationModule,
    BookingsModule,
    PaymentsModule,
    DynamicPricingModule,
    ReviewsModule,
    ChatModule,
    CouponsModule,
    SecurityModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
