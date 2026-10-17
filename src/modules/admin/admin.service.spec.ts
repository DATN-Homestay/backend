import * as crypto from 'crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AdminService } from './admin.service.js';
import {
  PayoutRequest,
  PayoutStatus,
} from '../payments/entities/payout-request.entity.js';
import {
  ClaimRequest,
  ClaimStatus,
} from '../verification/entities/claim-request.entity.js';
import { HostVerificationDocument } from '../verification/entities/host-verification-document.entity.js';
import {
  Homestay,
  HomestayStatus,
} from '../homestays/entities/homestay.entity.js';

// =========================================================
// MOCK FACTORIES
// =========================================================

/** Tạo mock Repository với các method cần thiết */
const mockRepo = () => ({
  find: vi.fn(),
  findOne: vi.fn(),
  update: vi.fn(),
  save: vi.fn(),
});

/** Tạo AES-256-CBC encrypted string theo đúng format của hệ thống (sync) */
function fakeEncryptedAES(plaintext: string): string {
  const dummyKey = Buffer.from(
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'hex',
  );
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', dummyKey, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

// =========================================================
// FIXTURE DATA
// =========================================================

/** Payout fixture - PENDING, tên khớp */
const mockPayout: Partial<PayoutRequest> = {
  id: '1',
  host_id: '10',
  booking_id: '100',
  total_booking_amount: 2000000,
  platform_commission: 150000,
  actual_payout_amount: 1850000,
  status: PayoutStatus.PENDING,
  created_at: new Date('2026-10-01'),
  host: {
    id: '10',
    full_name: 'NGUYEN VAN A',
    email: 'host@test.com',
    verification_document: {
      bank_account_holder_name: 'NGUYEN VAN A',
      bank_name: 'Vietcombank',
      bank_account_number_encrypted: '',  // sẽ được set trong beforeEach
    } as any,
  } as any,
};

/** Payout đã APPROVED */
const mockPayoutApproved: Partial<PayoutRequest> = {
  ...mockPayout,
  id: '2',
  status: PayoutStatus.APPROVED,
};

/** ClaimRequest fixture - PENDING_REVIEW */
const mockClaim: Partial<ClaimRequest> = {
  id: '50',
  host_id: '10',
  homestay_id: '200',
  status: ClaimStatus.PENDING_REVIEW,
  trust_score: 85,
  cccd_score: 40,
  phone_otp_score: 30,
  gps_score: 15,
  live_vision_score: 0,
  haversine_distance_m: 200,
  vision_similarity: 0.65,
  live_photo_url: 'https://res.cloudinary.com/test/live.jpg',
  rejection_reason: null,
  created_at: new Date('2026-10-10'),
  host: { id: '10', full_name: 'NGUYEN VAN A' } as any,
  homestay: { id: '200', name: 'Mây Homestay Đà Lạt' } as any,
  logs: [],
};

// =========================================================
// SETUP MODULE
// =========================================================

describe('AdminService', () => {
  let service: AdminService;
  let payoutRepo: ReturnType<typeof mockRepo>;
  let claimRepo: ReturnType<typeof mockRepo>;
  let verificationDocRepo: ReturnType<typeof mockRepo>;
  let homestayRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    payoutRepo = mockRepo();
    claimRepo = mockRepo();
    verificationDocRepo = mockRepo();
    homestayRepo = mockRepo();

    // Set AES_SECRET_KEY env cho decrypt hoạt động
    process.env.AES_SECRET_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(PayoutRequest), useValue: payoutRepo },
        { provide: getRepositoryToken(ClaimRequest), useValue: claimRepo },
        {
          provide: getRepositoryToken(HostVerificationDocument),
          useValue: verificationDocRepo,
        },
        { provide: getRepositoryToken(Homestay), useValue: homestayRepo },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  // =========================================================
  // PHÂN HỆ 1: PAYOUT MANAGEMENT
  // =========================================================

  describe('getPendingPayouts()', () => {
    it('nên trả về danh sách payout PENDING với thông tin giải mã STK', async () => {
      // Arrange — mã hóa STK bằng AES_SECRET_KEY giống service
      const key = Buffer.from(process.env.AES_SECRET_KEY!, 'hex');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      let enc = cipher.update('0987654321', 'utf8', 'hex');
      enc += cipher.final('hex');
      const encryptedSTK = `${iv.toString('hex')}:${enc}`;

      const payoutWithEncryptedSTK = {
        ...mockPayout,
        host: {
          ...mockPayout.host,
          verification_document: {
            ...mockPayout.host!.verification_document,
            bank_account_number_encrypted: encryptedSTK,
          },
        },
      };
      payoutRepo.find.mockResolvedValue([payoutWithEncryptedSTK]);

      // Act
      const result = await service.getPendingPayouts();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].payout_id).toBe('1');
      expect(result[0].bank_account_number_decrypted).toBe('0987654321');
      expect(result[0].cccd_name_match).toBe(true);
      expect(result[0].actual_payout_amount).toBe(1850000);
    });

    it('nên trả về danh sách rỗng khi không có payout nào', async () => {
      payoutRepo.find.mockResolvedValue([]);
      const result = await service.getPendingPayouts();
      expect(result).toHaveLength(0);
    });

    it('nên đặt cccd_name_match = false khi tên ngân hàng không khớp CCCD', async () => {
      const payoutMismatch = {
        ...mockPayout,
        host: {
          ...mockPayout.host,
          full_name: 'NGUYEN VAN A',
          verification_document: {
            bank_account_holder_name: 'TRAN THI B',
            bank_name: 'MB Bank',
            bank_account_number_encrypted: '',
          },
        },
      };
      payoutRepo.find.mockResolvedValue([payoutMismatch]);

      const result = await service.getPendingPayouts();

      expect(result[0].cccd_name_match).toBe(false);
    });

    it('nên xử lý graceful khi STK không thể giải mã', async () => {
      const payoutBadEnc = {
        ...mockPayout,
        host: {
          ...mockPayout.host,
          verification_document: {
            ...mockPayout.host!.verification_document,
            bank_account_number_encrypted: 'invalid:data',
          },
        },
      };
      payoutRepo.find.mockResolvedValue([payoutBadEnc]);

      const result = await service.getPendingPayouts();

      expect(result[0].bank_account_number_decrypted).toBeNull();
    });
  });

  describe('approvePayout()', () => {
    it('nên phê duyệt payout thành công khi tên khớp và trạng thái PENDING', async () => {
      payoutRepo.findOne.mockResolvedValue(mockPayout);
      payoutRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.approvePayout('1', '99', {
        receipt_image_url: 'https://cloudinary.com/receipt.jpg',
      });

      expect(payoutRepo.update).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({
          status: PayoutStatus.APPROVED,
          checker_admin_id: '99',
        }),
      );
      expect(result.message).toContain('Giải ngân thành công');
      expect(result.receipt_image_url).toBe('https://cloudinary.com/receipt.jpg');
    });

    it('nên throw NotFoundException khi không tìm thấy payout', async () => {
      payoutRepo.findOne.mockResolvedValue(null);

      await expect(
        service.approvePayout('999', '99', { receipt_image_url: '' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('nên throw BadRequestException khi payout đã APPROVED', async () => {
      payoutRepo.findOne.mockResolvedValue(mockPayoutApproved);

      await expect(
        service.approvePayout('2', '99', { receipt_image_url: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('nên throw BadRequestException khi tên ngân hàng không khớp tên CCCD', async () => {
      const payoutMismatch = {
        ...mockPayout,
        host: {
          ...mockPayout.host,
          full_name: 'NGUYEN VAN A',
          verification_document: {
            bank_account_holder_name: 'TRAN THI B',
            bank_name: 'MB Bank',
            bank_account_number_encrypted: '',
          },
        },
      };
      payoutRepo.findOne.mockResolvedValue(payoutMismatch);

      await expect(
        service.approvePayout('1', '99', { receipt_image_url: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('nên khớp tên có dấu tiếng Việt với tên chuẩn hóa chữ hoa', async () => {
      // "Nguyễn Văn A" vs "NGUYEN VAN A" → phải khớp
      const payoutVietnamese = {
        ...mockPayout,
        host: {
          ...mockPayout.host,
          full_name: 'Nguyễn Văn A',
          verification_document: {
            bank_account_holder_name: 'NGUYEN VAN A',
            bank_name: 'Vietcombank',
            bank_account_number_encrypted: '',
          },
        },
      };
      payoutRepo.findOne.mockResolvedValue(payoutVietnamese);
      payoutRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.approvePayout('1', '99', {
        receipt_image_url: 'https://receipt.jpg',
      });

      expect(result.message).toContain('Giải ngân thành công');
    });
  });

  describe('rejectPayout()', () => {
    it('nên từ chối payout PENDING thành công', async () => {
      payoutRepo.findOne.mockResolvedValue(mockPayout);
      payoutRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.rejectPayout(
        '1',
        '99',
        'Sai số tài khoản ngân hàng',
      );

      expect(payoutRepo.update).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ status: PayoutStatus.REJECTED }),
      );
      expect(result.message).toContain('Sai số tài khoản ngân hàng');
    });

    it('nên throw NotFoundException khi payout không tồn tại', async () => {
      payoutRepo.findOne.mockResolvedValue(null);

      await expect(service.rejectPayout('999', '99', 'Lý do')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('nên throw BadRequestException khi từ chối payout đã APPROVED', async () => {
      payoutRepo.findOne.mockResolvedValue(mockPayoutApproved);

      await expect(
        service.rejectPayout('2', '99', 'Lý do'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================
  // PHÂN HỆ 2: CLAIM REVIEW
  // =========================================================

  describe('getPendingClaims()', () => {
    it('nên trả về danh sách claim đang PENDING_REVIEW', async () => {
      claimRepo.find.mockResolvedValue([mockClaim]);

      const result = await service.getPendingClaims();

      expect(result).toHaveLength(1);
      expect(result[0].claim_id).toBe('50');
      expect(result[0].trust_score).toBe(85);
      expect(result[0].homestay_name).toBe('Mây Homestay Đà Lạt');
      expect(result[0].vision_similarity).toBe(0.65);
    });

    it('nên trả về mảng rỗng khi không có claim nào chờ duyệt', async () => {
      claimRepo.find.mockResolvedValue([]);
      const result = await service.getPendingClaims();
      expect(result).toHaveLength(0);
    });

    it('nên truy vấn đúng where: status = PENDING_REVIEW', async () => {
      claimRepo.find.mockResolvedValue([]);
      await service.getPendingClaims();

      expect(claimRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: ClaimStatus.PENDING_REVIEW },
        }),
      );
    });
  });

  describe('approveClaim()', () => {
    it('nên phê duyệt claim và kích hoạt homestay thành công', async () => {
      claimRepo.findOne.mockResolvedValue(mockClaim);
      claimRepo.update.mockResolvedValue({ affected: 1 });
      homestayRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.approveClaim('50', '99');

      // Kiểm tra claim được cập nhật APPROVED
      expect(claimRepo.update).toHaveBeenCalledWith(
        '50',
        expect.objectContaining({ status: ClaimStatus.APPROVED }),
      );

      // Kiểm tra homestay được kích hoạt chính chủ
      expect(homestayRepo.update).toHaveBeenCalledWith(
        '200',
        expect.objectContaining({
          is_claimed: 1,
          host_id: '10',
          status: HomestayStatus.ACTIVE,
        }),
      );

      expect(result.message).toContain('Homestay đã được cấp quyền chính chủ');
      expect(result.homestay_id).toBe('200');
    });

    it('nên throw NotFoundException khi claim không tồn tại', async () => {
      claimRepo.findOne.mockResolvedValue(null);

      await expect(service.approveClaim('999', '99')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('nên throw BadRequestException khi claim không ở trạng thái PENDING_REVIEW', async () => {
      const approvedClaim = { ...mockClaim, status: ClaimStatus.APPROVED };
      claimRepo.findOne.mockResolvedValue(approvedClaim);

      await expect(service.approveClaim('50', '99')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('nên KHÔNG cập nhật homestay nếu approve claim thất bại', async () => {
      claimRepo.findOne.mockResolvedValue(null);

      await expect(service.approveClaim('999', '99')).rejects.toThrow();
      expect(homestayRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('rejectClaim()', () => {
    it('nên từ chối claim với lý do hợp lệ', async () => {
      claimRepo.findOne.mockResolvedValue(mockClaim);
      claimRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.rejectClaim('50', '99', {
        rejection_reason: 'Ảnh live không khớp với ảnh thương mại, similarity < 0.75',
      });

      expect(claimRepo.update).toHaveBeenCalledWith(
        '50',
        expect.objectContaining({
          status: ClaimStatus.REJECTED,
          rejection_reason:
            'Ảnh live không khớp với ảnh thương mại, similarity < 0.75',
        }),
      );
      expect(result.message).toContain('Đã từ chối hồ sơ Claim #50');
    });

    it('nên throw NotFoundException khi claim không tồn tại', async () => {
      claimRepo.findOne.mockResolvedValue(null);

      await expect(
        service.rejectClaim('999', '99', { rejection_reason: 'Lý do' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('nên throw BadRequestException khi từ chối claim đã APPROVED', async () => {
      const approvedClaim = { ...mockClaim, status: ClaimStatus.APPROVED };
      claimRepo.findOne.mockResolvedValue(approvedClaim);

      await expect(
        service.rejectClaim('50', '99', { rejection_reason: 'Lý do' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================
  // PHÂN HỆ 3: RAPIDAPI SYNC
  // =========================================================

  describe('syncRapidApiMarketData()', () => {
    it('nên trả về thông tin sync thành công', async () => {
      const result = await service.syncRapidApiMarketData(
        { city: 'Đà Lạt', forecast_days: 14 },
        '99',
      );

      expect(result.message).toContain('Đồng bộ dữ liệu giá');
      expect(result.data.city).toBe('Đà Lạt');
      expect(result.data.forecast_days).toBe(14);
      expect(result.data.synced_at).toBeDefined();
      expect(result.data.execution_time_ms).toBeGreaterThanOrEqual(0);
    });

    it('nên dùng forecast_days mặc định là 14 nếu không truyền', async () => {
      const result = await service.syncRapidApiMarketData(
        { city: 'Hà Nội' },
        '99',
      );

      expect(result.data.forecast_days).toBe(14);
    });

    it('nên accept forecast_days tùy chỉnh', async () => {
      const result = await service.syncRapidApiMarketData(
        { city: 'Vũng Tàu', forecast_days: 7 },
        '99',
      );

      expect(result.data.forecast_days).toBe(7);
      expect(result.data.city).toBe('Vũng Tàu');
    });
  });

  // =========================================================
  // PRIVATE HELPERS (kiểm tra gián tiếp qua public methods)
  // =========================================================

  describe('normalizeName() (kiểm tra gián tiếp)', () => {
    const casesToMatch = [
      ['NGUYEN VAN A', 'NGUYEN VAN A', true],
      ['Nguyễn Văn A', 'NGUYEN VAN A', true],
      ['nguyen van a', 'NGUYEN VAN A', true],
      ['TRẦN THỊ B', 'TRAN THI B', true],
      ['LE  HOANG  LONG', 'LE HOANG LONG', true],  // double spaces
      ['NGUYEN VAN A', 'NGUYEN VAN B', false],
    ] as const;

    casesToMatch.forEach(([holderName, cccdName, shouldMatch]) => {
      it(`"${holderName}" vs "${cccdName}" → khớp: ${shouldMatch}`, async () => {
        const payoutToTest = {
          ...mockPayout,
          status: PayoutStatus.PENDING,
          host: {
            ...mockPayout.host,
            full_name: cccdName,
            verification_document: {
              bank_account_holder_name: holderName,
              bank_name: 'Vietcombank',
              bank_account_number_encrypted: '',
            },
          },
        };
        payoutRepo.findOne.mockResolvedValue(payoutToTest);
        payoutRepo.update.mockResolvedValue({ affected: 1 });

        if (shouldMatch) {
          const result = await service.approvePayout('1', '99', {
            receipt_image_url: 'url',
          });
          expect(result.message).toContain('Giải ngân thành công');
        } else {
          await expect(
            service.approvePayout('1', '99', { receipt_image_url: 'url' }),
          ).rejects.toThrow(BadRequestException);
        }
      });
    });
  });
});
