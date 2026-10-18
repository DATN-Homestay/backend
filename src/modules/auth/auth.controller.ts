import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ResponseMessage } from '../../common/decorators/response.decorator.js';
import type { AuthUser, ClientContext } from './auth.types.js';

const ONE_MINUTE_MS = 60_000;

/**
 * Auth Controller - Xác thực & phiên đăng nhập (REQ-028)
 * Base route: /api/v1/auth
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** POST /auth/register - Đăng ký tài khoản CUSTOMER hoặc HOST */
  @Post('register')
  @Throttle({ default: { limit: 3, ttl: ONE_MINUTE_MS } })
  @ResponseMessage('Đăng ký tài khoản thành công')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /** POST /auth/login - Cấp Access Token & Refresh Token */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
  @ResponseMessage('Đăng nhập thành công')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, this.clientContext(req));
  }

  /** POST /auth/refresh - Đổi refresh token lấy cặp token mới */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: ONE_MINUTE_MS } })
  @ResponseMessage('Làm mới token thành công')
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto.refresh_token, this.clientContext(req));
  }

  /** POST /auth/logout - Thu hồi phiên hiện tại (lấy từ token, không nhận từ body) */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Đăng xuất thành công')
  logout(@CurrentUser() user: AuthUser) {
    return this.authService.logout(user);
  }

  /** GET /auth/me - Thông tin người dùng đang đăng nhập */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user);
  }

  private clientContext(req: Request): ClientContext {
    return {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    };
  }
}
