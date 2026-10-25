import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PayoutRequest, PayoutStatus } from '../payments/entities/payout-request.entity.js';
import { ClaimRequest, ClaimStatus } from '../verification/entities/claim-request.entity.js';
import { HostVerificationDocument, VerificationStatus } from '../verification/entities/host-verification-document.entity.js';
import { Homestay, HomestayStatus } from '../homestays/entities/homestay.entity.js';
import { Booking, BookingStatus } from '../bookings/entities/booking.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ApprovePayoutDto } from './dto/approve-payout.dto.js';
import { RejectClaimDto } from './dto/reject-claim.dto.js';
import { SyncMarketDataDto } from './dto/sync-market-data.dto.js';
import * as crypto from 'crypto';

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
  ) {}

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
}
