import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { ApprovePayoutDto } from './dto/approve-payout.dto.js';
import { RejectClaimDto } from './dto/reject-claim.dto.js';
import { SyncMarketDataDto } from './dto/sync-market-data.dto.js';

// TODO: Thêm JwtAuthGuard và RolesGuard khi auth module hoàn thiện
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
// import { RolesGuard } from '../auth/guards/roles.guard.js';
// import { Roles } from '../auth/decorators/roles.decorator.js';

/**
 * Admin Controller - Toàn quyền hệ thống (RBAC Role: ADMIN)
 * Base route: /admin
 */
@Controller('admin')
// @UseGuards(JwtAuthGuard, RolesGuard)
// @Roles('ADMIN')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // =========================================================
  // PHÂN HỆ 1: ĐỐI SOÁT & GIẢI NGÂN PAYOUT (REQ-016, BR-013)
  // =========================================================

  /**
   * GET /admin/payouts/pending
   * Lấy danh sách payout chờ Admin phê duyệt (Checker).
   * Giải mã AES-256 STK ngân hàng + kiểm tra khớp tên CCCD.
   */
  @Get('payouts/pending')
  getPendingPayouts() {
    return this.adminService.getPendingPayouts();
  }

  /**
   * POST /admin/payouts/:id/approve
   * Admin (Checker) xác nhận đã chuyển khoản và upload biên lai ngân hàng.
   */
  @Post('payouts/:id/approve')
  approvePayout(
    @Param('id') payoutId: string,
    @Body() dto: ApprovePayoutDto,
    @Request() req: any,
  ) {
    // TODO: Lấy adminId từ req.user khi đã có JwtAuthGuard
    const adminId = req.user?.id ?? '1';
    return this.adminService.approvePayout(payoutId, adminId, dto);
  }

  /**
   * POST /admin/payouts/:id/reject
   * Admin từ chối giải ngân với lý do cụ thể.
   */
  @Post('payouts/:id/reject')
  rejectPayout(
    @Param('id') payoutId: string,
    @Body('reason') reason: string,
    @Request() req: any,
  ) {
    const adminId = req.user?.id ?? '1';
    return this.adminService.rejectPayout(payoutId, adminId, reason);
  }

  // =========================================================
  // PHÂN HỆ 2: DUYỆT HỒ SƠ eKYC CLAIM (Trust Score 70-99)
  // =========================================================

  /**
   * GET /admin/claims/pending
   * Lấy danh sách hồ sơ eKYC chờ Admin xét duyệt thủ công (trust score 70-99).
   */
  @Get('claims/pending')
  getPendingClaims() {
    return this.adminService.getPendingClaims();
  }

  /**
   * POST /admin/claims/:id/approve
   * Admin phê duyệt thủ công hồ sơ xác thực chính chủ Homestay.
   * → is_claimed = 1, status = ACTIVE
   */
  @Post('claims/:id/approve')
  approveClaim(@Param('id') claimId: string, @Request() req: any) {
    const adminId = req.user?.id ?? '1';
    return this.adminService.approveClaim(claimId, adminId);
  }

  /**
   * POST /admin/claims/:id/reject
   * Admin từ chối hồ sơ xác thực với lý do.
   */
  @Post('claims/:id/reject')
  rejectClaim(
    @Param('id') claimId: string,
    @Body() dto: RejectClaimDto,
    @Request() req: any,
  ) {
    const adminId = req.user?.id ?? '1';
    return this.adminService.rejectClaim(claimId, adminId, dto);
  }

  // =========================================================
  // PHÂN HỆ 3: ĐỒNG BỘ DỮ LIỆU THỊ TRƯỜNG RAPIDAPI (FLOW-06)
  // =========================================================

  /**
   * POST /admin/sync/rapidapi-market-data
   * Kích hoạt thủ công đồng bộ giá thị trường từ RapidAPI cho một thành phố.
   * (Thông thường chạy qua Cronjob 02:00 AM)
   */
  @Post('sync/rapidapi-market-data')
  syncRapidApiMarketData(@Body() dto: SyncMarketDataDto, @Request() req: any) {
    const adminId = req.user?.id ?? '1';
    return this.adminService.syncRapidApiMarketData(dto, adminId);
  }
}
