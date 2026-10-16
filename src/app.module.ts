import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as fs from 'fs';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import {
  User,
  Role,
  HostVerificationDocument,
  Homestay,
  Room,
  RoomImage,
  PriceCalendar,
  ClaimRequest,
  VerificationLog,
  Booking,
  PaymentTransaction,
  EscrowHold,
  RefundTransaction,
  PayoutRequest,
  Review,
  Coupon,
  Conversation,
  Message,
  ReviewAbsaMetric,
  AiPricingLog,
  FraudLog,
} from './entities/index.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isSsl = configService.get<string>('DB_SSL', 'false') === 'true';
        const caPath = configService.get<string>('DB_SSL_CA_PATH');

        let sslOptions: any = undefined;
        if (isSsl) {
          if (caPath && fs.existsSync(caPath)) {
            sslOptions = {
              rejectUnauthorized: true,
              ca: fs.readFileSync(caPath).toString(),
            };
          } else {
            sslOptions = {
              rejectUnauthorized: false,
            };
          }
        }

        return {
          type: 'mysql',
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: parseInt(configService.get<string>('DB_PORT', '3306'), 10),
          username: configService.get<string>('DB_USERNAME', 'avnadmin'),
          password: configService.get<string>('DB_PASSWORD', ''),
          database: configService.get<string>('DB_DATABASE', 'defaultdb'),
          entities: [
            User,
            Role,
            HostVerificationDocument,
            Homestay,
            Room,
            RoomImage,
            PriceCalendar,
            ClaimRequest,
            VerificationLog,
            Booking,
            PaymentTransaction,
            EscrowHold,
            RefundTransaction,
            PayoutRequest,
            Review,
            Coupon,
            Conversation,
            Message,
            ReviewAbsaMetric,
            AiPricingLog,
            FraudLog,
          ],
          synchronize: configService.get<string>('DB_SYNCHRONIZE', 'true') === 'true', // Tự động sinh bảng khi chạy
          autoLoadEntities: true,
          logging: configService.get<string>('NODE_ENV') !== 'production',
          ssl: sslOptions,
          extra: {
            connectionLimit: 10,
          },
        };
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
