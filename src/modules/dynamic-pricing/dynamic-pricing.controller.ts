import {
  Controller,
  Get,
  Put,
  Query,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DynamicPricingService } from './dynamic-pricing.service.js';
import { ApplyPricingDto } from './dto/apply-pricing.dto.js';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RoleType } from '../users/entities/role.entity.js';

@Controller('host/pricing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.HOST, RoleType.ADMIN)
export class DynamicPricingController {
  constructor(private readonly dynamicPricingService: DynamicPricingService) {}

  private getHostId(req: any): string {
    return String(req.user?.id || req.user?.sub || (req.headers['x-user-id'] as string) || '1');
  }

  /**
   * Lấy mức giá gợi ý thông minh từ AI (áp dụng Cache TTL 6 tiếng)
   */
  @Get('suggestions')
  async getSuggestions(
    @Req() req: any,
    @Query('homestay_id') homestayId: string,
    @Query('date') date: string,
    @Query('room_id') roomId?: string,
  ) {
    const hostId = this.getHostId(req);
    const data = await this.dynamicPricingService.getPricingSuggestions(
      hostId,
      homestayId,
      date,
      roomId,
    );
    return {
      statusCode: 200,
      data,
    };
  }

  /**
   * Host xác nhận áp dụng mức giá do AI đề xuất
   */
  @Put('apply')
  async applyPrice(@Req() req: any, @Body() dto: ApplyPricingDto) {
    const hostId = this.getHostId(req);
    const data = await this.dynamicPricingService.applyPricing(hostId, dto);
    return {
      statusCode: 200,
      message: 'Áp dụng giá mới thành công! Bảng lịch giá đã được cập nhật.',
      data,
    };
  }
}
