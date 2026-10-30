import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import * as fs from 'fs';
import { User, Role } from '../modules/users/entities/index.js';
import { UserSession } from '../modules/auth/entities/index.js';
import {
  HostVerificationDocument,
  ClaimRequest,
  VerificationLog,
} from '../modules/verification/entities/index.js';
import {
  Homestay,
  Room,
  RoomImage,
  PriceCalendar,
} from '../modules/homestays/entities/index.js';
import {
  Booking,
  EscrowHold,
  RefundTransaction,
} from '../modules/bookings/entities/index.js';
import {
  PaymentTransaction,
  PayoutRequest,
} from '../modules/payments/entities/index.js';
import { AiPricingLog } from '../modules/dynamic-pricing/entities/index.js';
import { Review, ReviewAbsaMetric } from '../modules/reviews/entities/index.js';
import { Conversation, Message } from '../modules/chat/entities/index.js';
import { Coupon } from '../modules/coupons/entities/index.js';
import { FraudLog } from '../modules/security/entities/index.js';

export const databaseConfigAsync: TypeOrmModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const isSsl = configService.get<string>('DB_SSL', 'false') === 'true';
    let caPath = configService.get<string>('DB_SSL_CA_PATH');

    if (!caPath || !fs.existsSync(caPath)) {
      if (fs.existsSync('./certs/ca.pem')) {
        caPath = './certs/ca.pem';
      } else if (fs.existsSync('./src/certs/ca.pem')) {
        caPath = './src/certs/ca.pem';
      }
    }

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
        UserSession,
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
      synchronize: configService.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
      autoLoadEntities: true,
      logging: false,
      ssl: sslOptions,
      extra: {
        connectionLimit: 10,
      },
    };
  },
};
