import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, Role } from '../users/entities/index.js';
import { UserSession } from './entities/index.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { RoleSeedService } from './role-seed.service.js';

/**
 * Global để JwtAuthGuard (cần AuthTokenService) dùng được ở mọi module
 * mà không phải import AuthModule.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, UserSession]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_ACCESS_SECRET');
        // Chặn cả giá trị mẫu copy nguyên từ .env.example
        if (!secret || secret.length < 32 || secret.startsWith('change_me')) {
          throw new Error(
            'Thiếu JWT_ACCESS_SECRET (tối thiểu 32 ký tự, ngẫu nhiên) trong file .env',
          );
        }
        return { secret };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthTokenService, RoleSeedService],
  exports: [AuthTokenService],
})
export class AuthModule {}
