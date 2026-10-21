import {
  Controller,
  Get,
  Put,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BookingsService } from './bookings.service.js';
import { BookingStatus } from './entities/booking.entity.js';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RoleType } from '../users/entities/role.entity.js';

@Controller('host/bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.HOST, RoleType.ADMIN)
export class HostBookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  private getHostId(req: any): string {
    return String(req.user?.id || req.user?.sub || (req.headers['x-user-id'] as string) || '1');
  }

  /**
   * Lấy danh sách đơn đặt phòng tại các Homestay của Host
   */
  @Get()
  async getBookings(
    @Req() req: any,
    @Query('homestay_id') homestayId?: string,
    @Query('status') status?: BookingStatus,
    @Query('from_date') fromDate?: string,
    @Query('to_date') toDate?: string,
  ) {
    const hostId = this.getHostId(req);
    const data = await this.bookingsService.getHostBookings(
      hostId,
      homestayId,
      status,
      fromDate,
      toDate,
    );
    return {
      statusCode: 200,
      data,
    };
  }

  /**
   * Host xác nhận khách đã đến nhận phòng thực tế (Check-in)
   * Kích hoạt đếm ngược 24h Escrow
   */
  @Put(':id/check-in')
  async checkIn(@Req() req: any, @Param('id') bookingId: string) {
    const hostId = this.getHostId(req);
    const data = await this.bookingsService.checkIn(hostId, bookingId);
    return {
      statusCode: 200,
      message: 'Xác nhận nhận phòng thành công',
      data,
    };
  }

  /**
   * Host xác nhận khách đã trả phòng (Check-out)
   * Đơn hàng chuyển sang COMPLETED
   */
  @Put(':id/check-out')
  async checkOut(@Req() req: any, @Param('id') bookingId: string) {
    const hostId = this.getHostId(req);
    const data = await this.bookingsService.checkOut(hostId, bookingId);
    return {
      statusCode: 200,
      message: 'Xác nhận trả phòng thành công. Đơn hàng hoàn tất.',
      data,
    };
  }
}
