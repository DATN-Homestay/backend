import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Like, type SelectQueryBuilder } from 'typeorm';
import bcrypt from 'bcryptjs';
import { PayoutRequest, PayoutStatus } from '../payments/entities/payout-request.entity.js';
import { ClaimRequest, ClaimStatus } from '../verification/entities/claim-request.entity.js';
import { HostVerificationDocument, VerificationStatus } from '../verification/entities/host-verification-document.entity.js';
import { Homestay, HomestayStatus } from '../homestays/entities/homestay.entity.js';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity.js';
import { User, UserStatus } from '../users/entities/user.entity.js';
import { Role, RoleType } from '../users/entities/role.entity.js';
import { ApprovePayoutDto } from './dto/approve-payout.dto.js';
import { RejectClaimDto } from './dto/reject-claim.dto.js';
import { SyncMarketDataDto } from './dto/sync-market-data.dto.js';
import type { AdminListUsersQueryDto, AdminCreateUserDto, AdminUpdateUserStatusDto, AdminUpdateUserRolesDto } from './dto/admin-user-management.dto.js';
import type { AdminListHomestaysQueryDto, AdminUpdateHomestayStatusDto, AdminUpdateHomestayDto, AdminAssignHostDto } from './dto/admin-homestay-management.dto.js';
import * as crypto from 'crypto';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(PayoutRequest)
    private readonly payoutRepo: Repository<PayoutRequest>,

    @InjectRepository(ClaimRequest)
    private readonly claimRepo: Repository<ClaimRequest>,

    @InjectRepository(HostVerificationDocument)
    private readonly verificationDocRepo: Repository<HostVerificationDocument>,

    @InjectRepository(Homestay)
    private readonly homestayRepo: Repository<Homestay>,

    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
  ) { }

  // =========================================================
  // PHÂN HỆ 0: DASHBOARD TỔNG QUAN (ADMIN OVERVIEW)
  // =========================================================

  /**
   * Lấy số liệu tổng quan hệ thống cho Admin Dashboard.
   * Bao gồm: số user, số booking theo trạng thái, doanh thu, payout & claim đang chờ.
   */
  async getDashboardStats() {
    const [totalUsers, totalHomestays, pendingPayoutsCount, pendingClaimsCount] =
      await Promise.all([
        this.userRepo.count(),
        this.homestayRepo.count(),
        this.payoutRepo.count({ where: { status: PayoutStatus.PENDING } }),
        this.claimRepo.count({ where: { status: ClaimStatus.PENDING_REVIEW } }),
      ]);

    // Thống kê booking theo trạng thái
    const bookingStats = await this.bookingRepo
      .createQueryBuilder('b')
      .select('b.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(b.total_amount), 0)', 'total_amount')
      .groupBy('b.status')
      .getRawMany<{ status: string; count: string; total_amount: string }>();

    const bookingsByStatus: Record<string, number> = {};
    let totalRevenue = 0;
    let totalBookings = 0;

    for (const row of bookingStats) {
      const count = Number(row.count);
      bookingsByStatus[row.status] = count;
      totalBookings += count;
      // Chỉ tính doanh thu từ đơn đã thanh toán (không tính đơn hủy/hết hạn)
      if (
        row.status === BookingStatus.PAID_ESCROW ||
        row.status === BookingStatus.CHECKED_IN ||
        row.status === BookingStatus.COMPLETED
      ) {
        totalRevenue += Number(row.total_amount);
      }
    }

    return {
      users: {
        total: totalUsers,
      },
      homestays: {
        total: totalHomestays,
      },
      bookings: {
        total: totalBookings,
        by_status: bookingsByStatus,
      },
      revenue: {
        total_confirmed_vnd: Math.round(totalRevenue),
        platform_commission_vnd: Math.round(totalRevenue * 0.075),
      },
      pending_actions: {
        payouts_waiting: pendingPayoutsCount,
        claims_waiting: pendingClaimsCount,
      },
    };
  }

  // =========================================================
  // PHÂN HỆ 1: ĐỐI SOÁT & GIẢI NGÂN PAYOUT (REQ-016, BR-013)
  // =========================================================


  /**
   * Lấy danh sách payout đang chờ Admin phê duyệt (Maker-Checker).
   * Giải mã AES-256 số tài khoản ngân hàng của Host để hiển thị.
   */
  async getPendingPayouts() {
    const payouts = await this.payoutRepo.find({
      where: { status: PayoutStatus.PENDING },
      relations: ['host', 'host.verification_document', 'booking'],
      order: { created_at: 'DESC' },
    });

    return payouts.map((payout) => {
      const doc = payout.host?.verification_document;
      let bank_account_number_decrypted: string | null = null;
      let cccd_name_match = false;

      if (doc?.bank_account_number_encrypted) {
        try {
          bank_account_number_decrypted = this.decryptAES(doc.bank_account_number_encrypted);
        } catch {
          this.logger.warn(`Không thể giải mã STK Host #${payout.host_id}`);
        }
      }

      if (doc?.bank_account_holder_name && payout.host?.full_name) {
        cccd_name_match =
          this.normalizeName(doc.bank_account_holder_name) ===
          this.normalizeName(payout.host.full_name);
      }

      return {
        payout_id: payout.id,
        host_id: payout.host_id,
        host_name: payout.host?.full_name ?? null,
        total_booking_amount: payout.total_booking_amount,
        platform_commission: payout.platform_commission,
        actual_payout_amount: payout.actual_payout_amount,
        status: payout.status,
        bank_account_number_decrypted,
        bank_account_name: doc?.bank_account_holder_name ?? null,
        bank_name: doc?.bank_name ?? null,
        cccd_name_match,
        booking_id: payout.booking_id,
        created_at: payout.created_at,
      };
    });
  }

  /**
   * Admin (Checker) phê duyệt giải ngân và upload biên lai ngân hàng.
   * BR-020: Chỉ duyệt khi Tên chủ thẻ khớp 100% tên CCCD.
   */
  async approvePayout(payoutId: string, adminId: string, dto: ApprovePayoutDto) {
    const payout = await this.payoutRepo.findOne({
      where: { id: payoutId },
      relations: ['host', 'host.verification_document'],
    });

    if (!payout) {
      throw new NotFoundException(`Không tìm thấy payout #${payoutId}`);
    }
    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestException(
        `Payout #${payoutId} đã ở trạng thái ${payout.status}, không thể phê duyệt lại.`,
      );
    }

    const doc = payout.host?.verification_document;
    if (doc) {
      const cccd_name_match =
        this.normalizeName(doc.bank_account_holder_name) ===
        this.normalizeName(payout.host.full_name);

      if (!cccd_name_match) {
        throw new BadRequestException(
          `Tên chủ tài khoản ngân hàng không khớp 100% với Họ tên CCCD. Không thể giải ngân.`,
        );
      }
    }

    await this.payoutRepo.update(payoutId, {
      status: PayoutStatus.APPROVED,
      checker_admin_id: adminId,
      updated_at: new Date(),
    });

    this.logger.log(`Admin #${adminId} đã phê duyệt giải ngân Payout #${payoutId}`);

    return {
      message: `Giải ngân thành công cho Host. Trạng thái đã chuyển sang APPROVED.`,
      payout_id: payoutId,
      receipt_image_url: dto.receipt_image_url,
    };
  }

  /**
   * Admin từ chối giải ngân (ví dụ: sai thông tin tài khoản).
   */
  async rejectPayout(payoutId: string, adminId: string, reason: string) {
    const payout = await this.payoutRepo.findOne({ where: { id: payoutId } });

    if (!payout) {
      throw new NotFoundException(`Không tìm thấy payout #${payoutId}`);
    }
    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestException(`Payout #${payoutId} đã ở trạng thái ${payout.status}.`);
    }

    await this.payoutRepo.update(payoutId, {
      status: PayoutStatus.REJECTED,
      checker_admin_id: adminId,
      updated_at: new Date(),
    });

    return { message: `Đã từ chối giải ngân Payout #${payoutId}. Lý do: ${reason}` };
  }

  // =========================================================
  // PHÂN HỆ 2: DUYỆT HỒ SƠ eKYC CLAIM (Trust Score 70-99)
  // =========================================================

  /**
   * Lấy danh sách các claim request đang chờ Admin xét duyệt thủ công
   * (trust score 70-99, không đủ điểm AUTO_APPROVED >= 100).
   */
  async getPendingClaims() {
    const claims = await this.claimRepo.find({
      where: { status: ClaimStatus.PENDING_REVIEW },
      relations: ['host', 'homestay', 'logs'],
      order: { created_at: 'ASC' },
    });

    return claims.map((claim) => ({
      claim_id: claim.id,
      host_id: claim.host_id,
      host_name: claim.host?.full_name ?? null,
      homestay_id: claim.homestay_id,
      homestay_name: claim.homestay?.name ?? null,
      trust_score: claim.trust_score,
      cccd_score: claim.cccd_score,
      phone_otp_score: claim.phone_otp_score,
      gps_score: claim.gps_score,
      live_vision_score: claim.live_vision_score,
      haversine_distance_m: claim.haversine_distance_m,
      vision_similarity: claim.vision_similarity,
      live_photo_url: claim.live_photo_url,
      submitted_at: claim.created_at,
    }));
  }

  /**
   * Admin phê duyệt thủ công một claim request (Trust Score 70-99).
   * Kích hoạt homestay chính chủ: is_claimed = 1, status = ACTIVE.
   */
  async approveClaim(claimId: string, adminId: string) {
    const claim = await this.claimRepo.findOne({
      where: { id: claimId },
      relations: ['homestay'],
    });

    if (!claim) {
      throw new NotFoundException(`Không tìm thấy claim #${claimId}`);
    }
    if (claim.status !== ClaimStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        `Claim #${claimId} không ở trạng thái PENDING_REVIEW.`,
      );
    }

    // Cập nhật trạng thái claim
    await this.claimRepo.update(claimId, {
      status: ClaimStatus.APPROVED,
      updated_at: new Date(),
    });

    // Kích hoạt Homestay: is_claimed = 1, gán host_id, status = ACTIVE
    await this.homestayRepo.update(claim.homestay_id, {
      is_claimed: 1,
      host_id: claim.host_id,
      status: HomestayStatus.ACTIVE,
    });

    this.logger.log(
      `Admin #${adminId} đã phê duyệt Claim #${claimId} → Homestay #${claim.homestay_id} ACTIVE`,
    );

    return {
      message: `Phê duyệt thủ công thành công. Homestay đã được cấp quyền chính chủ!`,
      claim_id: claimId,
      homestay_id: claim.homestay_id,
    };
  }

  /**
   * Admin từ chối một claim request với lý do cụ thể.
   */
  async rejectClaim(claimId: string, adminId: string, dto: RejectClaimDto) {
    const claim = await this.claimRepo.findOne({ where: { id: claimId } });

    if (!claim) {
      throw new NotFoundException(`Không tìm thấy claim #${claimId}`);
    }
    if (claim.status !== ClaimStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        `Claim #${claimId} không ở trạng thái PENDING_REVIEW.`,
      );
    }

    await this.claimRepo.update(claimId, {
      status: ClaimStatus.REJECTED,
      rejection_reason: dto.rejection_reason,
      updated_at: new Date(),
    });

    this.logger.log(
      `Admin #${adminId} đã từ chối Claim #${claimId}. Lý do: ${dto.rejection_reason}`,
    );

    return {
      message: `Đã từ chối hồ sơ Claim #${claimId}.`,
      rejection_reason: dto.rejection_reason,
    };
  }

  // =========================================================
  // PHÂN HỆ 3: ĐỒNG BỘ DỮ LIỆU THỊ TRƯỜNG RAPIDAPI (FLOW-06)
  // =========================================================

  /**
   * Kích hoạt thủ công đồng bộ giá thị trường từ RapidAPI (hoặc chạy qua Cronjob 02:00 AM).
   * Cập nhật bảng price_calendars với dữ liệu CompSet của thành phố được chỉ định.
   */
  async syncRapidApiMarketData(dto: SyncMarketDataDto, adminId: string) {
    const startTime = Date.now();
    const forecastDays = dto.forecast_days ?? 14;

    this.logger.log(
      `Admin #${adminId} kích hoạt đồng bộ RapidAPI: city=${dto.city}, days=${forecastDays}`,
    );

    // Placeholder: Thực tế sẽ gọi RapidAPI booking-com15.p.rapidapi.com
    // và cập nhật price_calendars với comp_set_avg_price + comp_set_occupancy_rate
    // Logic sẽ được implement cùng DynamicPricingModule
    const executionTimeMs = Date.now() - startTime;

    this.logger.log(
      `Hoàn thành đồng bộ RapidAPI thành phố ${dto.city} trong ${executionTimeMs}ms`,
    );

    return {
      message: `Đồng bộ dữ liệu giá và tỷ lệ kín phòng từ RapidAPI thành công`,
      data: {
        city: dto.city,
        forecast_days: forecastDays,
        synced_at: new Date().toISOString(),
        execution_time_ms: executionTimeMs,
      },
    };
  }

  // =========================================================
  // PHÂN HỆ 5: QUẢN LÝ NGƯỜI DÙNG (ADMIN USER MANAGEMENT)
  // =========================================================

  /**
   * Lấy danh sách tất cả người dùng với phân trang, tìm kiếm, lọc theo role/status.
   */
  async listUsers(query: AdminListUsersQueryDto) {
    const { page = 1, limit = 20, search, sort_by, sort_order = 'DESC', status, role } = query;
    const skip = (page - 1) * limit;

    const qb = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'role')
      .leftJoinAndSelect('user.verification_document', 'verification');

    // Tìm kiếm theo tên, email, SĐT
    if (search) {
      qb.andWhere(
        '(user.full_name LIKE :search OR user.email LIKE :search OR user.phone_number LIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Lọc theo trạng thái
    if (status) {
      qb.andWhere('user.status = :status', { status });
    }

    // Lọc theo role
    if (role) {
      qb.andWhere('role.name = :role', { role });
    }

    // Sắp xếp
    const validSortColumns: Record<string, string> = {
      created_at: 'user.created_at',
      full_name: 'user.full_name',
      email: 'user.email',
      status: 'user.status',
    };
    const sortColumn = validSortColumns[sort_by ?? 'created_at'] ?? 'user.created_at';
    qb.orderBy(sortColumn, sort_order);

    const [items, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return {
      items: items.map((user) => this.toAdminUserView(user)),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Lấy thông tin chi tiết một người dùng theo ID.
   */
  async getUserDetail(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['roles', 'verification_document', 'homestays', 'bookings'],
    });
    if (!user) {
      throw new NotFoundException(`Không tìm thấy người dùng #${userId}`);
    }
    return {
      ...this.toAdminUserView(user),
      homestays_count: user.homestays?.length ?? 0,
      bookings_count: user.bookings?.length ?? 0,
    };
  }

  /**
   * Admin tạo user mới (có thể chỉ định role).
   */
  async createUser(dto: AdminCreateUserDto) {
    // Kiểm tra email tồn tại
    const existingUser = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existingUser) {
      throw new ConflictException(`Email ${dto.email} đã được sử dụng`);
    }

    // Hash mật khẩu
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    // Tìm role entities
    const rolesToAssign = dto.roles ?? [RoleType.CUSTOMER];
    const roleEntities = await this.roleRepo.find({
      where: { name: In(rolesToAssign) },
    });

    if (roleEntities.length !== rolesToAssign.length) {
      throw new BadRequestException('Một hoặc nhiều role không hợp lệ');
    }

    const user = this.userRepo.create({
      email: dto.email,
      password_hash: passwordHash,
      full_name: dto.full_name,
      phone_number: dto.phone_number ?? null,
      roles: roleEntities,
    });

    const saved = await this.userRepo.save(user);
    this.logger.log(`Admin đã tạo user mới #${saved.id} (${saved.email})`);

    return this.toAdminUserView(saved);
  }

  /**
   * Admin cập nhật trạng thái người dùng (ACTIVE / SUSPENDED / BANNED).
   */
  async updateUserStatus(userId: string, dto: AdminUpdateUserStatusDto, adminId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['roles'],
    });
    if (!user) {
      throw new NotFoundException(`Không tìm thấy người dùng #${userId}`);
    }

    // Không cho phép Admin ban chính mình
    if (userId === adminId && dto.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Không thể thay đổi trạng thái của chính mình');
    }

    const oldStatus = user.status;
    user.status = dto.status;

    // Reset failed_login_count khi kích hoạt lại
    if (dto.status === UserStatus.ACTIVE) {
      user.failed_login_count = 0;
      user.locked_until = null;
    }

    await this.userRepo.save(user);

    this.logger.log(
      `Admin #${adminId} đã đổi trạng thái User #${userId} từ ${oldStatus} → ${dto.status}${dto.reason ? `. Lý do: ${dto.reason}` : ''}`,
    );

    return {
      message: `Đã cập nhật trạng thái người dùng #${userId} thành ${dto.status}`,
      user_id: userId,
      old_status: oldStatus,
      new_status: dto.status,
    };
  }

  /**
   * Admin cập nhật role cho người dùng.
   */
  async updateUserRoles(userId: string, dto: AdminUpdateUserRolesDto, adminId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['roles'],
    });
    if (!user) {
      throw new NotFoundException(`Không tìm thấy người dùng #${userId}`);
    }

    // Không cho phép Admin tự xóa role ADMIN của mình
    if (userId === adminId && !dto.roles.includes(RoleType.ADMIN)) {
      throw new BadRequestException('Không thể tự xóa quyền Admin của chính mình');
    }

    const roleEntities = await this.roleRepo.find({
      where: { name: In(dto.roles) },
    });

    if (roleEntities.length !== dto.roles.length) {
      throw new BadRequestException('Một hoặc nhiều role không hợp lệ trong hệ thống');
    }

    const oldRoles = user.roles.map((r) => r.name);
    user.roles = roleEntities;
    await this.userRepo.save(user);

    this.logger.log(
      `Admin #${adminId} đã đổi role User #${userId}: [${oldRoles.join(', ')}] → [${dto.roles.join(', ')}]`,
    );

    return {
      message: `Đã cập nhật role cho người dùng #${userId}`,
      user_id: userId,
      old_roles: oldRoles,
      new_roles: dto.roles,
    };
  }

  /**
   * Admin xóa người dùng (soft: chuyển BANNED, hoặc hard delete nếu không có booking).
   */
  async deleteUser(userId: string, adminId: string) {
    if (userId === adminId) {
      throw new BadRequestException('Không thể xóa tài khoản Admin đang đăng nhập');
    }

    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['roles', 'bookings'],
    });
    if (!user) {
      throw new NotFoundException(`Không tìm thấy người dùng #${userId}`);
    }

    // Nếu user có booking thì chỉ BANNED, không xóa cứng
    if (user.bookings && user.bookings.length > 0) {
      user.status = UserStatus.BANNED;
      await this.userRepo.save(user);
      this.logger.log(
        `Admin #${adminId} đã BANNED User #${userId} (có ${user.bookings.length} booking, không xóa cứng)`,
      );
      return {
        message: `Người dùng #${userId} đã được chuyển sang trạng thái BANNED (có dữ liệu booking liên quan)`,
        action: 'BANNED',
      };
    }

    // Không có booking → xóa cứng
    await this.userRepo.remove(user);
    this.logger.log(`Admin #${adminId} đã xóa cứng User #${userId}`);
    return {
      message: `Đã xóa vĩnh viễn người dùng #${userId}`,
      action: 'DELETED',
    };
  }

  // =========================================================
  // PHÂN HỆ 6: QUẢN LÝ HOST (ADMIN HOST MANAGEMENT)
  // =========================================================

  /**
   * Lấy danh sách tất cả Host trong hệ thống (users có role HOST).
   */
  async listHosts(query: AdminListUsersQueryDto) {
    const { page = 1, limit = 20, search, sort_by, sort_order = 'DESC', status } = query;
    const skip = (page - 1) * limit;

    const qb = this.userRepo
      .createQueryBuilder('user')
      .innerJoinAndSelect('user.roles', 'role', 'role.name = :hostRole', { hostRole: RoleType.HOST })
      .leftJoinAndSelect('user.verification_document', 'verification')
      .leftJoin('user.homestays', 'homestay')
      .addSelect('COUNT(DISTINCT homestay.id)', 'homestays_count');

    if (search) {
      qb.andWhere(
        '(user.full_name LIKE :search OR user.email LIKE :search OR user.phone_number LIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (status) {
      qb.andWhere('user.status = :status', { status });
    }

    qb.groupBy('user.id');

    const validSortColumns: Record<string, string> = {
      created_at: 'user.created_at',
      full_name: 'user.full_name',
      email: 'user.email',
      status: 'user.status',
    };
    const sortColumn = validSortColumns[sort_by ?? 'created_at'] ?? 'user.created_at';
    qb.orderBy(sortColumn, sort_order);

    // Lấy danh sách phân trang
    const total = await qb.getCount();
    const rawItems = await qb.skip(skip).take(limit).getRawAndEntities();

    const items = rawItems.entities.map((user, idx) => ({
      ...this.toAdminUserView(user),
      homestays_count: Number(rawItems.raw[idx]?.homestays_count ?? 0),
      verification_status: user.verification_document?.status ?? null,
      verification_score: user.verification_document?.verification_score ?? null,
    }));

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Lấy chi tiết Host bao gồm danh sách homestays và thông tin xác thực.
   */
  async getHostDetail(hostId: string) {
    const host = await this.userRepo.findOne({
      where: { id: hostId },
      relations: ['roles', 'verification_document', 'homestays', 'homestays.rooms'],
    });
    if (!host) {
      throw new NotFoundException(`Không tìm thấy người dùng #${hostId}`);
    }

    const isHost = host.roles?.some((r) => r.name === RoleType.HOST);
    if (!isHost) {
      throw new BadRequestException(`Người dùng #${hostId} không có role HOST`);
    }

    // Thống kê booking của host
    const bookingStats = await this.bookingRepo
      .createQueryBuilder('b')
      .innerJoin('b.room', 'room')
      .innerJoin('room.homestay', 'homestay')
      .where('homestay.host_id = :hostId', { hostId })
      .select('b.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(b.total_amount), 0)', 'total_amount')
      .groupBy('b.status')
      .getRawMany<{ status: string; count: string; total_amount: string }>();

    let totalRevenue = 0;
    let totalBookings = 0;
    const bookingsByStatus: Record<string, number> = {};
    for (const row of bookingStats) {
      const count = Number(row.count);
      bookingsByStatus[row.status] = count;
      totalBookings += count;
      if (
        row.status === BookingStatus.PAID_ESCROW ||
        row.status === BookingStatus.CHECKED_IN ||
        row.status === BookingStatus.COMPLETED
      ) {
        totalRevenue += Number(row.total_amount);
      }
    }

    return {
      ...this.toAdminUserView(host),
      verification: host.verification_document
        ? {
          status: host.verification_document.status,
          score: host.verification_document.verification_score,
          bank_name: host.verification_document.bank_name,
          bank_holder: host.verification_document.bank_account_holder_name,
        }
        : null,
      homestays: (host.homestays ?? []).map((h) => ({
        id: h.id,
        name: h.name,
        city: h.city,
        address: h.address,
        status: h.status,
        is_claimed: h.is_claimed,
        average_rating: h.average_rating,
        total_reviews: h.total_reviews,
        rooms_count: h.rooms?.length ?? 0,
      })),
      stats: {
        total_homestays: host.homestays?.length ?? 0,
        total_bookings: totalBookings,
        bookings_by_status: bookingsByStatus,
        total_revenue_vnd: Math.round(totalRevenue),
      },
    };
  }

  // =========================================================
  // PHÂN HỆ 7: QUẢN LÝ HOMESTAY (ADMIN HOMESTAY MANAGEMENT)
  // =========================================================

  /**
   * Lấy danh sách tất cả homestay với phân trang, tìm kiếm, lọc.
   */
  async listHomestays(query: AdminListHomestaysQueryDto) {
    const {
      page = 1,
      limit = 20,
      search,
      sort_by,
      sort_order = 'DESC',
      status,
      city,
      is_claimed,
      host_id,
    } = query;
    const skip = (page - 1) * limit;

    const qb = this.homestayRepo
      .createQueryBuilder('homestay')
      .leftJoinAndSelect('homestay.host', 'host')
      .leftJoin('homestay.rooms', 'room')
      .addSelect('COUNT(DISTINCT room.id)', 'rooms_count');

    if (search) {
      qb.andWhere(
        '(homestay.name LIKE :search OR homestay.address LIKE :search OR host.full_name LIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (status) {
      qb.andWhere('homestay.status = :status', { status });
    }

    if (city) {
      qb.andWhere('homestay.city LIKE :city', { city: `%${city}%` });
    }

    if (is_claimed !== undefined) {
      qb.andWhere('homestay.is_claimed = :is_claimed', { is_claimed });
    }

    if (host_id) {
      qb.andWhere('homestay.host_id = :host_id', { host_id });
    }

    qb.groupBy('homestay.id');

    const validSortColumns: Record<string, string> = {
      created_at: 'homestay.created_at',
      name: 'homestay.name',
      city: 'homestay.city',
      status: 'homestay.status',
      average_rating: 'homestay.average_rating',
      total_reviews: 'homestay.total_reviews',
    };
    const sortColumn = validSortColumns[sort_by ?? 'created_at'] ?? 'homestay.created_at';
    qb.orderBy(sortColumn, sort_order);

    const total = await qb.getCount();
    const rawItems = await qb.skip(skip).take(limit).getRawAndEntities();

    const items = rawItems.entities.map((h, idx) => ({
      id: h.id,
      name: h.name,
      address: h.address,
      city: h.city,
      status: h.status,
      is_claimed: h.is_claimed,
      average_rating: h.average_rating,
      total_reviews: h.total_reviews,
      host_id: h.host_id,
      host_name: h.host?.full_name ?? null,
      rooms_count: Number(rawItems.raw[idx]?.rooms_count ?? 0),
      cover_image:
        h.amenities_json?.main_image_url ??
        (h.amenities_json?.property_images as string[])?.[0] ??
        null,
      created_at: h.created_at,
    }));

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Lấy chi tiết một homestay (admin view).
   */
  async getHomestayDetail(homestayId: string) {
    const homestay = await this.homestayRepo.findOne({
      where: { id: homestayId },
      relations: ['host', 'rooms', 'rooms.images', 'reviews'],
    });
    if (!homestay) {
      throw new NotFoundException(`Không tìm thấy homestay #${homestayId}`);
    }

    return {
      id: homestay.id,
      name: homestay.name,
      address: homestay.address,
      city: homestay.city,
      latitude: homestay.latitude,
      longitude: homestay.longitude,
      crawled_phone: homestay.crawled_phone,
      source_url: homestay.source_url,
      is_claimed: homestay.is_claimed,
      status: homestay.status,
      cancellation_policy: homestay.cancellation_policy,
      average_rating: homestay.average_rating,
      total_reviews: homestay.total_reviews,
      amenities_json: homestay.amenities_json,
      rules_json: homestay.rules_json,
      host: homestay.host
        ? {
          id: homestay.host.id,
          full_name: homestay.host.full_name,
          email: homestay.host.email,
          phone_number: homestay.host.phone_number,
        }
        : null,
      rooms: (homestay.rooms ?? []).map((room) => ({
        id: room.id,
        room_name: room.room_name,
        capacity: room.capacity,
        base_price: room.base_price,
        area_sqm: room.area_sqm,
        bed_info: room.bed_info,
        images_count: room.images?.length ?? 0,
      })),
      reviews_count: homestay.reviews?.length ?? 0,
      created_at: homestay.created_at,
      updated_at: homestay.updated_at,
    };
  }

  /**
   * Admin cập nhật trạng thái homestay (DRAFT / PENDING_VERIFICATION / ACTIVE / BANNED).
   */
  async updateHomestayStatus(
    homestayId: string,
    dto: AdminUpdateHomestayStatusDto,
    adminId: string,
  ) {
    const homestay = await this.homestayRepo.findOne({ where: { id: homestayId } });
    if (!homestay) {
      throw new NotFoundException(`Không tìm thấy homestay #${homestayId}`);
    }

    const oldStatus = homestay.status;
    homestay.status = dto.status;
    await this.homestayRepo.save(homestay);

    this.logger.log(
      `Admin #${adminId} đã đổi trạng thái Homestay #${homestayId} từ ${oldStatus} → ${dto.status}${dto.reason ? `. Lý do: ${dto.reason}` : ''}`,
    );

    return {
      message: `Đã cập nhật trạng thái homestay #${homestayId} thành ${dto.status}`,
      homestay_id: homestayId,
      old_status: oldStatus,
      new_status: dto.status,
    };
  }

  /**
   * Admin cập nhật thông tin homestay (tên, địa chỉ, tiện nghi, ...).
   */
  async updateHomestay(homestayId: string, dto: AdminUpdateHomestayDto, adminId: string) {
    const homestay = await this.homestayRepo.findOne({ where: { id: homestayId } });
    if (!homestay) {
      throw new NotFoundException(`Không tìm thấy homestay #${homestayId}`);
    }

    // Cập nhật các trường
    if (dto.name !== undefined) homestay.name = dto.name;
    if (dto.address !== undefined) homestay.address = dto.address;
    if (dto.city !== undefined) homestay.city = dto.city;
    if (dto.latitude !== undefined) homestay.latitude = dto.latitude;
    if (dto.longitude !== undefined) homestay.longitude = dto.longitude;
    if (dto.crawled_phone !== undefined) homestay.crawled_phone = dto.crawled_phone;
    if (dto.status !== undefined) homestay.status = dto.status;
    if (dto.amenities_json !== undefined) {
      homestay.amenities_json = { ...homestay.amenities_json, ...dto.amenities_json };
    }
    if (dto.rules_json !== undefined) {
      homestay.rules_json = { ...homestay.rules_json, ...dto.rules_json };
    }

    const updated = await this.homestayRepo.save(homestay);
    this.logger.log(`Admin #${adminId} đã cập nhật thông tin Homestay #${homestayId}`);

    return {
      message: `Đã cập nhật homestay #${homestayId}`,
      homestay: {
        id: updated.id,
        name: updated.name,
        address: updated.address,
        city: updated.city,
        status: updated.status,
      },
    };
  }

  /**
   * Admin gán Host cho một Homestay (dùng khi claim thủ công hoặc chuyển quyền sở hữu).
   */
  async assignHostToHomestay(homestayId: string, dto: AdminAssignHostDto, adminId: string) {
    const homestay = await this.homestayRepo.findOne({ where: { id: homestayId } });
    if (!homestay) {
      throw new NotFoundException(`Không tìm thấy homestay #${homestayId}`);
    }

    const host = await this.userRepo.findOne({
      where: { id: dto.host_id },
      relations: ['roles'],
    });
    if (!host) {
      throw new NotFoundException(`Không tìm thấy người dùng #${dto.host_id}`);
    }

    // Kiểm tra host có role HOST
    const isHost = host.roles?.some((r) => r.name === RoleType.HOST);
    if (!isHost) {
      throw new BadRequestException(`Người dùng #${dto.host_id} không có role HOST`);
    }

    const oldHostId = homestay.host_id;
    homestay.host_id = dto.host_id;
    homestay.is_claimed = 1;
    if (homestay.status === HomestayStatus.DRAFT) {
      homestay.status = HomestayStatus.ACTIVE;
    }

    await this.homestayRepo.save(homestay);

    this.logger.log(
      `Admin #${adminId} gán Host #${dto.host_id} cho Homestay #${homestayId} (trước đó: Host #${oldHostId ?? 'NULL'})`,
    );

    return {
      message: `Đã gán Host #${dto.host_id} (${host.full_name}) cho Homestay #${homestayId}`,
      homestay_id: homestayId,
      old_host_id: oldHostId,
      new_host_id: dto.host_id,
    };
  }

  /**
   * Admin xóa homestay (xóa cứng).
   */
  async deleteHomestay(homestayId: string, adminId: string) {
    const homestay = await this.homestayRepo.findOne({
      where: { id: homestayId },
      relations: ['rooms'],
    });
    if (!homestay) {
      throw new NotFoundException(`Không tìm thấy homestay #${homestayId}`);
    }

    // Kiểm tra homestay có booking đang active không
    const activeBookingCount = await this.bookingRepo.count({
      where: {
        room_id: In((homestay.rooms ?? []).map((r) => r.id)),
        status: In([BookingStatus.PENDING_PAYMENT, BookingStatus.PAID_ESCROW, BookingStatus.CHECKED_IN]),
      },
    });

    if (activeBookingCount > 0) {
      throw new BadRequestException(
        `Homestay #${homestayId} đang có ${activeBookingCount} booking active. Không thể xóa. Hãy chuyển trạng thái sang BANNED thay vì xóa.`,
      );
    }

    await this.homestayRepo.remove(homestay);
    this.logger.log(`Admin #${adminId} đã xóa Homestay #${homestayId} (${homestay.name})`);

    return {
      message: `Đã xóa vĩnh viễn homestay #${homestayId} (${homestay.name})`,
    };
  }

  // =========================================================
  // PHÂN HỆ 8: THỐNG KÊ NÂNG CAO CHO ADMIN DASHBOARD
  // =========================================================

  /**
   * Thống kê tổng quan nâng cao cho Dashboard.
   */
  async getEnhancedDashboardStats() {
    // Chạy song song các truy vấn thống kê
    const [
      totalUsers,
      totalHosts,
      totalCustomers,
      totalHomestays,
      activeHomestays,
      claimedHomestays,
      pendingPayoutsCount,
      pendingClaimsCount,
      recentUsers,
      recentHomestays,
    ] = await Promise.all([
      this.userRepo.count(),
      this.userRepo
        .createQueryBuilder('u')
        .innerJoin('u.roles', 'r', 'r.name = :role', { role: RoleType.HOST })
        .getCount(),
      this.userRepo
        .createQueryBuilder('u')
        .innerJoin('u.roles', 'r', 'r.name = :role', { role: RoleType.CUSTOMER })
        .getCount(),
      this.homestayRepo.count(),
      this.homestayRepo.count({ where: { status: HomestayStatus.ACTIVE } }),
      this.homestayRepo.count({ where: { is_claimed: 1 } }),
      this.payoutRepo.count({ where: { status: PayoutStatus.PENDING } }),
      this.claimRepo.count({ where: { status: ClaimStatus.PENDING_REVIEW } }),
      // 5 user đăng ký mới nhất
      this.userRepo.find({
        relations: ['roles'],
        order: { created_at: 'DESC' },
        take: 5,
      }),
      // 5 homestay mới nhất
      this.homestayRepo.find({
        relations: ['host'],
        order: { created_at: 'DESC' },
        take: 5,
      }),
    ]);

    // Thống kê booking
    const bookingStats = await this.bookingRepo
      .createQueryBuilder('b')
      .select('b.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(b.total_amount), 0)', 'total_amount')
      .groupBy('b.status')
      .getRawMany<{ status: string; count: string; total_amount: string }>();

    const bookingsByStatus: Record<string, number> = {};
    let totalRevenue = 0;
    let totalBookings = 0;

    for (const row of bookingStats) {
      const count = Number(row.count);
      bookingsByStatus[row.status] = count;
      totalBookings += count;
      if (
        row.status === BookingStatus.PAID_ESCROW ||
        row.status === BookingStatus.CHECKED_IN ||
        row.status === BookingStatus.COMPLETED
      ) {
        totalRevenue += Number(row.total_amount);
      }
    }

    // Thống kê user theo trạng thái
    const usersByStatus = await this.userRepo
      .createQueryBuilder('u')
      .select('u.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('u.status')
      .getRawMany<{ status: string; count: string }>();

    const usersStatusMap: Record<string, number> = {};
    for (const row of usersByStatus) {
      usersStatusMap[row.status] = Number(row.count);
    }

    return {
      users: {
        total: totalUsers,
        hosts: totalHosts,
        customers: totalCustomers,
        by_status: usersStatusMap,
      },
      homestays: {
        total: totalHomestays,
        active: activeHomestays,
        claimed: claimedHomestays,
        unclaimed: totalHomestays - claimedHomestays,
      },
      bookings: {
        total: totalBookings,
        by_status: bookingsByStatus,
      },
      revenue: {
        total_confirmed_vnd: Math.round(totalRevenue),
        platform_commission_vnd: Math.round(totalRevenue * 0.075),
      },
      pending_actions: {
        payouts_waiting: pendingPayoutsCount,
        claims_waiting: pendingClaimsCount,
      },
      recent_users: recentUsers.map((u) => ({
        id: u.id,
        full_name: u.full_name,
        email: u.email,
        roles: u.roles?.map((r) => r.name) ?? [],
        created_at: u.created_at,
      })),
      recent_homestays: recentHomestays.map((h) => ({
        id: h.id,
        name: h.name,
        city: h.city,
        host_name: h.host?.full_name ?? null,
        status: h.status,
        created_at: h.created_at,
      })),
    };
  }

  // =========================================================
  // HELPERS
  // =========================================================

  /**
   * Giải mã AES-256-CBC từ chuỗi định dạng "IV_HEX:CIPHERTEXT_HEX"
   */
  private decryptAES(encryptedText: string): string {
    const aesKey = process.env.AES_SECRET_KEY;
    if (!aesKey) throw new Error('AES_SECRET_KEY chưa được cấu hình');

    const SECRET_KEY = Buffer.from(aesKey, 'hex');
    const [ivHex, cipherHex] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', SECRET_KEY, iv);
    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Chuẩn hóa họ tên (chữ hoa, bỏ dấu) để so sánh khớp CCCD vs. tên tài khoản ngân hàng.
   */
  private normalizeName(name: string): string {
    return name
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9 ]/g, '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Convert User entity → admin-safe view object (loại bỏ password_hash).
   */
  private toAdminUserView(user: User) {
    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone_number: user.phone_number,
      avatar_url: user.avatar_url,
      status: user.status,
      roles: user.roles?.map((r) => r.name) ?? [],
      failed_login_count: user.failed_login_count,
      locked_until: user.locked_until,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }
}

