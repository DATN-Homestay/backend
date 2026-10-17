import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ResponseMessage } from '../../common/decorators/response.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';

/**
 * Users Controller - Hồ sơ cá nhân & thiết bị đăng nhập (REQ-028)
 * Base route: /api/v1/users/me
 */
@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** GET /users/me - Hồ sơ người dùng hiện tại */
  @Get()
  getProfile(@CurrentUser() user: AuthUser) {
    return this.usersService.getProfile(user);
  }

  /** PATCH /users/me - Cập nhật họ tên */
  @Patch()
  @ResponseMessage('Cập nhật hồ sơ thành công')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user, dto);
  }

  /** PATCH /users/me/password - Đổi mật khẩu, đăng xuất các thiết bị khác */
  @Patch('password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ResponseMessage('Đổi mật khẩu thành công')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(user, dto);
  }

  /** GET /users/me/sessions - Danh sách thiết bị đang đăng nhập */
  @Get('sessions')
  listSessions(@CurrentUser() user: AuthUser) {
    return this.usersService.listSessions(user);
  }

  /** DELETE /users/me/sessions/:id - Thu hồi một phiên từ xa */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Đã thu hồi phiên đăng nhập')
  revokeSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.usersService.revokeSession(user, id);
  }
}
