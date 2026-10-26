import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { RapidApiCrawlerService } from './rapidapi-crawler.service.js';
import { ApprovePayoutDto } from './dto/approve-payout.dto.js';
import { RejectPayoutDto } from './dto/reject-payout.dto.js';
import { RejectClaimDto } from './dto/reject-claim.dto.js';
import { SyncMarketDataDto } from './dto/sync-market-data.dto.js';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ResponseMessage } from '../../common/decorators/response.decorator.js';
import { RoleType } from '../users/entities/role.entity.js';

import { B2bDemandFulfillmentService } from '../bookings/b2b-demand-fulfillment.service.js';
import { AdminListUsersQueryDto, AdminCreateUserDto, AdminUpdateUserStatusDto, AdminUpdateUserRolesDto } from './dto/admin-user-management.dto.js';
import { AdminListHomestaysQueryDto, AdminUpdateHomestayStatusDto, AdminUpdateHomestayDto, AdminAssignHostDto } from './dto/admin-homestay-management.dto.js';

/**
 * Admin Controller - Toàn quyền hệ thống (RBAC Role: ADMIN)
 * Base route: /api/v1/admin
 *
 * Mọi endpoint đều yêu cầu:
 *   - Bearer Access Token hợp lệ (JwtAuthGuard)
 *   - Role ADMIN (RolesGuard)
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly crawlerService: RapidApiCrawlerService,
    private readonly b2bFulfillmentService: B2bDemandFulfillmentService,
  ) {}

  // =========================================================
  // PHÂN HỆ 0: DASHBOARD TỔNG QUAN (ADMIN OVERVIEW)
  // =========================================================

  /**
   * GET /admin/dashboard/stats
   * Số liệu tổng quan hệ thống: user, homestay, booking theo trạng thái,
   * doanh thu tổng, hoa hồng sàn, payout & claim đang chờ xử lý.
   */
  @Get('dashboard/stats')
  @ResponseMessage('Lấy thống kê tổng quan thành công')
  getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  /**
   * GET /admin/dashboard/enhanced
   * Thống kê nâng cao cho Dashboard (chi tiết hơn).
   */
  @Get('dashboard/enhanced')
  @ResponseMessage('Lấy thống kê nâng cao thành công')
  getEnhancedDashboardStats() {
    return this.adminService.getEnhancedDashboardStats();
  }

  // =========================================================
  // PHÂN HỆ 1: ĐỐI SOÁT & GIẢI NGÂN PAYOUT (REQ-016, BR-013)
  // =========================================================

  /**
   * GET /admin/payouts/pending
   * Lấy danh sách payout chờ Admin phê duyệt (Checker).
   * Giải mã AES-256 STK ngân hàng + kiểm tra khớp tên CCCD.
   */
  @Get('payouts/pending')
  @ResponseMessage('Lấy danh sách payout chờ duyệt thành công')
  getPendingPayouts() {
    return this.adminService.getPendingPayouts();
  }

  /**
   * POST /admin/payouts/:id/approve
   * Admin (Checker) xác nhận đã chuyển khoản và upload biên lai ngân hàng.
   * BR-020: Chỉ duyệt khi tên chủ tài khoản khớp 100% tên CCCD.
   */
  @Post('payouts/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Giải ngân thành công cho Host')
  approvePayout(
    @Param('id') payoutId: string,
    @Body() dto: ApprovePayoutDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.approvePayout(payoutId, adminId, dto);
  }

  /**
   * POST /admin/payouts/:id/reject
   * Admin từ chối giải ngân với lý do cụ thể.
   */
  @Post('payouts/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Đã từ chối giải ngân')
  rejectPayout(
    @Param('id') payoutId: string,
    @Body() dto: RejectPayoutDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.rejectPayout(payoutId, adminId, dto.reason);
  }

  // =========================================================
  // PHÂN HỆ 2: DUYỆT HỒ SƠ eKYC CLAIM (Trust Score 70-99)
  // =========================================================

  /**
   * GET /admin/claims/pending
   * Lấy danh sách hồ sơ eKYC chờ Admin xét duyệt thủ công (trust score 70-99).
   */
  @Get('claims/pending')
  @ResponseMessage('Lấy danh sách hồ sơ chờ duyệt thành công')
  getPendingClaims() {
    return this.adminService.getPendingClaims();
  }

  /**
   * POST /admin/claims/:id/approve
   * Admin phê duyệt thủ công hồ sơ xác thực chính chủ Homestay.
   * → is_claimed = 1, status = ACTIVE
   */
  @Post('claims/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Phê duyệt thủ công thành công. Homestay đã được cấp quyền chính chủ!')
  approveClaim(
    @Param('id') claimId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.approveClaim(claimId, adminId);
  }

  /**
   * POST /admin/claims/:id/reject
   * Admin từ chối hồ sơ xác thực với lý do.
   */
  @Post('claims/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Đã từ chối hồ sơ xác thực')
  rejectClaim(
    @Param('id') claimId: string,
    @Body() dto: RejectClaimDto,
    @CurrentUser('id') adminId: string,
  ) {
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
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Đồng bộ dữ liệu giá và tỷ lệ kín phòng từ RapidAPI thành công')
  syncRapidApiMarketData(
    @Body() dto: SyncMarketDataDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.syncRapidApiMarketData(dto, adminId);
  }

  /**
   * POST /admin/sync/crawl-booking-homestays
   * Cào dữ liệu homestay từ Booking.com qua RapidAPI và lưu vào MySQL.
   */
  @Post('sync/crawl-booking-homestays')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Cào dữ liệu homestay thành công')
  async crawlBookingHomestays(
    @Body() body: { city?: string; limit?: number },
  ) {
    const city = body.city ?? 'Đà Lạt';
    const limit = body.limit ?? 10;
    return await this.crawlerService.crawlAndSaveHomestays(city, limit);
  }

  // =========================================================
  // PHÂN HỆ 4: QUẢN LÝ ĐƠN DROPSHIP B2B BOOKING.COM (MoR)
  // =========================================================

  /**
   * GET /admin/dropship/orders
   * Lấy danh sách các đơn đặt phòng tự động qua Booking.com Demand API
   */
  @Get('dropship/orders')
  async getDropshipOrders() {
    return await this.b2bFulfillmentService.getDropshipOrdersForAdmin();
  }

  /**
   * POST /admin/dropship/retry/:id
   * Admin bấm thử lại đặt phòng B2B cho một đơn
   */
  @Post('dropship/retry/:id')
  async retryDropshipOrder(@Param('id') bookingId: string) {
    return await this.b2bFulfillmentService.retryFulfillment(bookingId);
  }

  // =========================================================
  // PHÂN HỆ 5: QUẢN LÝ NGƯỜI DÙNG (ADMIN USER MANAGEMENT)
  // =========================================================

  /**
   * GET /admin/users
   * Lấy danh sách tất cả người dùng với phân trang, tìm kiếm, lọc theo role/status.
   */
  @Get('users')
  @ResponseMessage('Lấy danh sách người dùng thành công')
  listUsers(@Query() query: AdminListUsersQueryDto) {
    return this.adminService.listUsers(query);
  }

  /**
   * GET /admin/users/:id
   * Lấy thông tin chi tiết một người dùng theo ID.
   */
  @Get('users/:id')
  @ResponseMessage('Lấy chi tiết người dùng thành công')
  getUserDetail(@Param('id') userId: string) {
    return this.adminService.getUserDetail(userId);
  }

  /**
   * POST /admin/users
   * Admin tạo user mới (có thể chỉ định role).
   */
  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Tạo người dùng mới thành công')
  createUser(@Body() dto: AdminCreateUserDto) {
    return this.adminService.createUser(dto);
  }

  /**
   * PATCH /admin/users/:id/status
   * Admin cập nhật trạng thái người dùng (ACTIVE / SUSPENDED / BANNED).
   */
  @Patch('users/:id/status')
  @ResponseMessage('Cập nhật trạng thái người dùng thành công')
  updateUserStatus(
    @Param('id') userId: string,
    @Body() dto: AdminUpdateUserStatusDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.updateUserStatus(userId, dto, adminId);
  }

  /**
   * PATCH /admin/users/:id/roles
   * Admin cập nhật role cho người dùng.
   */
  @Patch('users/:id/roles')
  @ResponseMessage('Cập nhật role người dùng thành công')
  updateUserRoles(
    @Param('id') userId: string,
    @Body() dto: AdminUpdateUserRolesDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.updateUserRoles(userId, dto, adminId);
  }

  /**
   * DELETE /admin/users/:id
   * Admin xóa người dùng (soft: BANNED nếu có booking, hard delete nếu không).
   */
  @Delete('users/:id')
  @ResponseMessage('Xóa người dùng thành công')
  deleteUser(
    @Param('id') userId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.deleteUser(userId, adminId);
  }

  // =========================================================
  // PHÂN HỆ 6: QUẢN LÝ HOST (ADMIN HOST MANAGEMENT)
  // =========================================================

  /**
   * GET /admin/hosts
   * Lấy danh sách tất cả Host trong hệ thống (users có role HOST).
   */
  @Get('hosts')
  @ResponseMessage('Lấy danh sách host thành công')
  listHosts(@Query() query: AdminListUsersQueryDto) {
    return this.adminService.listHosts(query);
  }

  /**
   * GET /admin/hosts/:id
   * Lấy chi tiết Host bao gồm danh sách homestays, thống kê booking và thông tin xác thực.
   */
  @Get('hosts/:id')
  @ResponseMessage('Lấy chi tiết host thành công')
  getHostDetail(@Param('id') hostId: string) {
    return this.adminService.getHostDetail(hostId);
  }

  // =========================================================
  // PHÂN HỆ 7: QUẢN LÝ HOMESTAY (ADMIN HOMESTAY MANAGEMENT)
  // =========================================================

  /**
   * GET /admin/homestays
   * Lấy danh sách tất cả homestay với phân trang, tìm kiếm, lọc theo status/city/is_claimed/host_id.
   */
  @Get('homestays')
  @ResponseMessage('Lấy danh sách homestay thành công')
  listHomestays(@Query() query: AdminListHomestaysQueryDto) {
    return this.adminService.listHomestays(query);
  }

  /**
   * GET /admin/homestays/:id
   * Lấy chi tiết một homestay (admin view).
   */
  @Get('homestays/:id')
  @ResponseMessage('Lấy chi tiết homestay thành công')
  getHomestayDetail(@Param('id') homestayId: string) {
    return this.adminService.getHomestayDetail(homestayId);
  }

  /**
   * PATCH /admin/homestays/:id/status
   * Admin cập nhật trạng thái homestay (DRAFT / PENDING_VERIFICATION / ACTIVE / BANNED).
   */
  @Patch('homestays/:id/status')
  @ResponseMessage('Cập nhật trạng thái homestay thành công')
  updateHomestayStatus(
    @Param('id') homestayId: string,
    @Body() dto: AdminUpdateHomestayStatusDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.updateHomestayStatus(homestayId, dto, adminId);
  }

  /**
   * PATCH /admin/homestays/:id
   * Admin cập nhật thông tin homestay (tên, địa chỉ, tiện nghi, ...).
   */
  @Patch('homestays/:id')
  @ResponseMessage('Cập nhật thông tin homestay thành công')
  updateHomestay(
    @Param('id') homestayId: string,
    @Body() dto: AdminUpdateHomestayDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.updateHomestay(homestayId, dto, adminId);
  }

  /**
   * POST /admin/homestays/:id/assign-host
   * Admin gán Host cho một Homestay (dùng khi claim thủ công hoặc chuyển quyền sở hữu).
   */
  @Post('homestays/:id/assign-host')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Gán host cho homestay thành công')
  assignHostToHomestay(
    @Param('id') homestayId: string,
    @Body() dto: AdminAssignHostDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.assignHostToHomestay(homestayId, dto, adminId);
  }

  /**
   * DELETE /admin/homestays/:id
   * Admin xóa homestay (xóa cứng, chỉ khi không có booking active).
   */
  @Delete('homestays/:id')
  @ResponseMessage('Xóa homestay thành công')
  deleteHomestay(
    @Param('id') homestayId: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.deleteHomestay(homestayId, adminId);
  }
}
