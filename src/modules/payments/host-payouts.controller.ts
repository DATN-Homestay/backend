import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { RequestPayoutDto } from './dto/request-payout.dto.js';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RoleType } from '../users/entities/role.entity.js';

@Controller('host/payouts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.HOST, RoleType.ADMIN)
export class HostPayoutsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  private getHostId(req: any): string {
    return String(req.user?.id || req.user?.sub || (req.headers['x-user-id'] as string) || '1');
  }

  /**
   * Lấy số dư doanh thu phòng có thể rút, hoa hồng sàn 7.5% và số tiền chờ duyệt
   */
  @Get('balance')
  async getBalance(@Req() req: any) {
    const hostId = this.getHostId(req);
    const data = await this.paymentsService.getHostBalance(hostId);
    return {
      statusCode: 200,
      data,
    };
  }

  /**
   * Host tạo yêu cầu giải ngân (rút tiền về STK ngân hàng đã liên kết)
   */
  @Post('request')
  async requestPayout(@Req() req: any, @Body() dto: RequestPayoutDto) {
    const hostId = this.getHostId(req);
    const data = await this.paymentsService.requestPayout(hostId, dto);
    return {
      statusCode: 201,
      data,
    };
  }

  /**
   * Lấy lịch sử tất cả các lần yêu cầu giải ngân của Host
   */
  @Get('history')
  async getPayoutHistory(@Req() req: any) {
    const hostId = this.getHostId(req);
    const data = await this.paymentsService.getPayoutHistory(hostId);
    return {
      statusCode: 200,
      data,
    };
  }
}
