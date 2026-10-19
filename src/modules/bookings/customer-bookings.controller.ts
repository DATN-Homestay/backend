import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CustomerBookingsService } from './customer-bookings.service.js';
import { QuoteBookingDto } from './dto/quote-booking.dto.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';
import { ListBookingsDto } from './dto/list-bookings.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ResponseMessage } from '../../common/decorators/response.decorator.js';
import { RoleType } from '../users/entities/role.entity.js';
import type { AuthUser } from '../auth/auth.types.js';

/**
 * Customer Bookings Controller - Báo giá, đặt phòng, xem đơn của khách
 * Base route: /api/v1
 */
@Controller()
export class CustomerBookingsController {
  constructor(private readonly bookingsService: CustomerBookingsService) {}

  /** POST /bookings/quote - Báo giá theo từng đêm, không giữ chỗ (Public) */
  @Post('bookings/quote')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  quote(@Body() dto: QuoteBookingDto) {
    return this.bookingsService.quote(dto);
  }

  /** POST /bookings - Tạo đơn, khóa dòng chống Overbooking, giữ chỗ 15 phút */
  @Post('bookings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.CUSTOMER)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ResponseMessage('Giữ chỗ thành công, vui lòng thanh toán trong 15 phút')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return this.bookingsService.createBooking(user, dto);
  }

  /** GET /users/me/bookings - Đơn của tôi */
  @Get('users/me/bookings')
  @UseGuards(JwtAuthGuard)
  listMine(@CurrentUser() user: AuthUser, @Query() query: ListBookingsDto) {
    return this.bookingsService.listMine(user, query);
  }

  /** GET /bookings/:id - Chi tiết đơn (chủ đơn / Host của nhà / Admin) */
  @Get('bookings/:id')
  @UseGuards(JwtAuthGuard)
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!/^\d+$/.test(id)) {
      throw new NotFoundException('Không tìm thấy đơn đặt phòng');
    }
    return this.bookingsService.getDetail(user, id);
  }
}
