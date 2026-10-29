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
import { CancellationService } from './cancellation.service.js';
import { RefundProcessorService } from './refund-processor.service.js';
import { CancelBookingDto } from './dto/cancel-booking.dto.js';
import { ListRefundsDto, ManualRefundDto } from './dto/admin-refund.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ResponseMessage } from '../../common/decorators/response.decorator.js';
import { RoleType } from '../users/entities/role.entity.js';
import type { AuthUser } from '../auth/auth.types.js';

const numericId = (id: string, what: string): string => {
  if (!/^\d+$/.test(id)) throw new NotFoundException(`Không tìm thấy ${what}`);
  return id;
};

/**
 * Hủy đơn & hoàn tiền Escrow cho khách và Host
 * Base route: /api/v1
 */
@Controller()
export class CancellationController {
  constructor(private readonly cancellationService: CancellationService) {}

  /** GET /bookings/:id/cancellation-quote - Xem trước số tiền được hoàn nếu hủy ngay bây giờ */
  @Get('bookings/:id/cancellation-quote')
  @UseGuards(JwtAuthGuard)
  quote(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cancellationService.quote(user, numericId(id, 'đơn đặt phòng'));
  }

  /** POST /bookings/:id/cancel - Khách hủy đơn theo chính sách hủy của homestay */
  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.CUSTOMER)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ResponseMessage('Hủy đơn thành công')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelBookingDto) {
    return this.cancellationService.cancelByCustomer(user, numericId(id, 'đơn đặt phòng'), dto);
  }

  /** POST /host/bookings/:id/cancel - Host hủy đơn: khách được hoàn 100%, Host bị phạt 20% */
  @Post('host/bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.HOST)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ResponseMessage('Chủ nhà hủy đơn thành công, khách sẽ được hoàn 100%')
  cancelByHost(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelBookingDto) {
    return this.cancellationService.cancelByHost(user, numericId(id, 'đơn đặt phòng'), dto);
  }

  /** GET /users/me/refunds - Lịch sử hoàn tiền của tôi */
  @Get('users/me/refunds')
  @UseGuards(JwtAuthGuard)
  listMine(@CurrentUser() user: AuthUser) {
    return this.cancellationService.listMyRefunds(user);
  }
}

/**
 * Admin xử lý hoàn tiền: xem danh sách, thử lại khi VNPay lỗi, hoặc đánh dấu đã hoàn thủ công
 * Base route: /api/v1/admin/refunds
 */
@Controller('admin/refunds')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.ADMIN)
export class AdminRefundsController {
  constructor(private readonly refundProcessor: RefundProcessorService) {}

  @Get()
  list(@Query() query: ListRefundsDto) {
    return this.refundProcessor.listForAdmin(query.status, query.page ?? 1, query.limit ?? 20);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Đã gửi lại yêu cầu hoàn tiền')
  retry(@Param('id') id: string) {
    return this.refundProcessor.retry(numericId(id, 'yêu cầu hoàn tiền'));
  }

  @Post(':id/manual')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Đã ghi nhận hoàn tiền thủ công')
  markManual(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() dto: ManualRefundDto) {
    return this.refundProcessor.markManual(numericId(id, 'yêu cầu hoàn tiền'), admin.id, dto.note);
  }
}
