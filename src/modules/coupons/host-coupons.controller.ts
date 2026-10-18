import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CouponsService } from './coupons.service.js';
import { CreateHostCouponDto } from './dto/create-host-coupon.dto.js';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RoleType } from '../users/entities/role.entity.js';

@Controller('host/coupons')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.HOST, RoleType.ADMIN)
export class HostCouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  private getHostId(req: any): string {
    return String(req.user?.id || req.user?.sub || (req.headers['x-user-id'] as string) || '1');
  }

  @Get()
  async getMyCoupons(@Req() req: any) {
    const hostId = this.getHostId(req);
    const data = await this.couponsService.getHostCoupons(hostId);
    return {
      statusCode: 200,
      data,
    };
  }

  @Post()
  async createCoupon(@Req() req: any, @Body() dto: CreateHostCouponDto) {
    const hostId = this.getHostId(req);
    const data = await this.couponsService.createHostCoupon(hostId, dto);
    return {
      statusCode: 201,
      message: 'Tạo mã voucher thành công',
      data,
    };
  }

  @Delete(':id')
  async deleteCoupon(@Req() req: any, @Param('id') id: string) {
    const hostId = this.getHostId(req);
    const data = await this.couponsService.deleteHostCoupon(hostId, id);
    return {
      statusCode: 200,
      data,
    };
  }
}
