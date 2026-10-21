import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CustomerPaymentsService } from './customer-payments.service.js';
import { normalizeIp } from './vnpay.helper.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RawResponse } from '../../common/decorators/response.decorator.js';
import { RoleType } from '../users/entities/role.entity.js';
import type { AuthUser } from '../auth/auth.types.js';

const isNumericId = (id: string) => /^\d+$/.test(id);

/**
 * Customer Payments Controller - Thanh toán VNPay
 * Base route: /api/v1
 */
@Controller()
export class CustomerPaymentsController {
  constructor(private readonly paymentsService: CustomerPaymentsService) {}

  /** POST /bookings/:id/payment-url - Tạo URL thanh toán VNPay đã ký HMAC-SHA512 */
  @Post('bookings/:id/payment-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.CUSTOMER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createPaymentUrl(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    if (!isNumericId(id)) throw new NotFoundException('Không tìm thấy đơn đặt phòng');
    return this.paymentsService.createPaymentUrl(user, id, normalizeIp(req.ip));
  }

  /**
   * GET /vnpay/ipn - Webhook server-to-server của VNPay.
   * Không JWT (xác thực bằng chữ ký), KHÔNG giới hạn tần suất, trả đúng { RspCode, Message }.
   */
  @Get('vnpay/ipn')
  @RawResponse()
  @SkipThrottle()
  ipn(@Query() query: Record<string, unknown>) {
    return this.paymentsService.handleIpn(query);
  }

  /** GET /vnpay/return - Khách được VNPay chuyển về; chỉ hiển thị, không ghi DB */
  @Get('vnpay/return')
  @RawResponse()
  async returnUrl(@Query() query: Record<string, unknown>, @Res() res: Response) {
    res.redirect(302, await this.paymentsService.resolveReturnRedirect(query));
  }

  /** GET /payments/:id - Trạng thái giao dịch (frontend polling sau khi VNPay chuyển về) */
  @Get('payments/:id')
  @UseGuards(JwtAuthGuard)
  getPayment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!isNumericId(id)) throw new NotFoundException('Không tìm thấy giao dịch');
    return this.paymentsService.getPayment(user, id);
  }
}
