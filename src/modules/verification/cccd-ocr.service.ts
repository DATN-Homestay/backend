import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import Tesseract from 'tesseract.js';

export interface ExtractedCccdData {
  cccd_number?: string;
  full_name?: string;
  date_of_birth?: string;
  gender?: string;
  nationality?: string;
  place_of_origin?: string;
  place_of_residence?: string;
  expiry_date?: string;
  raw_text?: string;
}

export interface CccdScanResult {
  is_valid_format: boolean;
  is_tampered_or_fake: boolean;
  tamper_reasons: string[];
  extracted_data: ExtractedCccdData;
  card_type: 'CCCD_CHIP' | 'CCCD_MA_VACH' | 'CMND_9SO' | 'UNKNOWN';
}

// Bảng tra cứu 63 tỉnh/thành phố theo quy chuẩn Bộ Công An Việt Nam
export const VIETNAM_PROVINCE_CODES: Record<string, string> = {
  '001': 'Hà Nội',
  '002': 'Hà Giang',
  '004': 'Cao Bằng',
  '006': 'Bắc Kạn',
  '008': 'Tuyên Quang',
  '010': 'Lào Cai',
  '011': 'Điện Biên',
  '012': 'Lai Châu',
  '014': 'Sơn La',
  '015': 'Yên Bái',
  '017': 'Hòa Bình',
  '019': 'Thái Nguyên',
  '020': 'Lạng Sơn',
  '022': 'Quảng Ninh',
  '024': 'Bắc Giang',
  '025': 'Phú Thọ',
  '026': 'Vĩnh Phúc',
  '027': 'Bắc Ninh',
  '030': 'Hải Dương',
  '031': 'Hải Phòng',
  '033': 'Hưng Yên',
  '034': 'Thái Bình',
  '035': 'Hà Nam',
  '036': 'Nam Định',
  '037': 'Ninh Bình',
  '038': 'Thanh Hóa',
  '040': 'Nghệ An',
  '042': 'Hà Tĩnh',
  '044': 'Quảng Bình',
  '045': 'Quảng Trị',
  '046': 'Thừa Thiên Huế',
  '048': 'Đà Nẵng',
  '049': 'Quảng Nam',
  '051': 'Quảng Ngãi',
  '052': 'Bình Định',
  '054': 'Phú Yên',
  '056': 'Khánh Hòa',
  '058': 'Ninh Thuận',
  '060': 'Bình Thuận',
  '062': 'Kon Tum',
  '064': 'Gia Lai',
  '066': 'Đắk Lắk',
  '067': 'Đắk Nông',
  '068': 'Lâm Đồng',
  '070': 'Bình Phước',
  '072': 'Tây Ninh',
  '074': 'Bình Dương',
  '075': 'Đồng Nai',
  '077': 'Bà Rịa - Vũng Tàu',
  '079': 'TP. Hồ Chí Minh',
  '080': 'Long An',
  '082': 'Tiền Giang',
  '083': 'Bến Tre',
  '084': 'Trà Vinh',
  '086': 'Vĩnh Long',
  '087': 'Đồng Tháp',
  '089': 'An Giang',
  '091': 'Kiên Giang',
  '092': 'Cần Thơ',
  '093': 'Hậu Giang',
  '094': 'Sóc Trăng',
  '095': 'Bạc Liêu',
  '096': 'Cà Mau',
};

// Từ khóa báo hiệu ảnh phôi mẫu trên mạng / ảnh làm giả
const FAKE_SAMPLE_KEYWORDS = [
  'SAMPLE',
  'PHOTOSHOP',
  'PHOI CCCD',
  'PHÔI CCCD',
  'PHOI CAN CUOC',
  'MAU THU',
  'MẪU THỬ',
  'TEST CARD',
  'DEMO ONLY',
  'SKIBIDI',
  'WATERMARK',
  'SHUTTERSTOCK',
  'FREEPIK',
  'GETTYIMAGES',
  'PNGTREE',
  'VECTOR',
  'DOWNLOAD',
];

// Từ khóa bảo chứng bắt buộc của thẻ CCCD mặt trước
const FRONT_CARD_REQUIRED_KEYWORDS = [
  'CONG HOA',
  'CỘNG HÒA',
  'VIET NAM',
  'VIỆT NAM',
  'DOC LAP',
  'ĐỘC LẬP',
  'CAN CUOC',
  'CĂN CƯỚC',
  'CONG DAN',
  'CÔNG DÂN',
  'SO',
  'SỐ',
  'NO',
  'HO VA TEN',
  'HỌ VÀ TÊN',
  'FULL NAME',
  'CITIZEN',
  'IDENTITY',
];

// Từ khóa bảo chứng mặt sau
const BACK_CARD_REQUIRED_KEYWORDS = [
  'DAC DIEM',
  'ĐẶC ĐIỂM',
  'NGON TRO',
  'NGÓN TRỎ',
  'VAN TAY',
  'VÂN TAY',
  'BO CONG AN',
  'BỘ CÔNG AN',
  'CUC CANH SAT',
  'CỤC CẢNH SÁT',
  'NGAY CAP',
  'NGÀY CẤP',
  'DATE',
  'CHIP',
  '<<<',
];

@Injectable()
export class CccdOcrService {
  private readonly logger = new Logger(CccdOcrService.name);

  /**
   * 1. Kiểm tra tính hợp lệ toán học cấu trúc 12 số CCCD
   */
  validateCccdStructure(cccdNumber: string): {
    isValid: boolean;
    provinceName?: string;
    birthYear?: number;
    gender?: 'Nam' | 'Nữ';
    error?: string;
  } {
    const cleaned = cccdNumber.trim();
    if (!/^\d{12}$/.test(cleaned)) {
      return { isValid: false, error: 'Số CCCD phải gồm đúng 12 chữ số' };
    }

    // 3 chữ số đầu: Mã tỉnh/thành phố
    const provinceCode = cleaned.slice(0, 3);
    const provinceName = VIETNAM_PROVINCE_CODES[provinceCode];
    if (!provinceName) {
      return {
        isValid: false,
        error: `Mã tỉnh '${provinceCode}' không hợp lệ hoặc không tồn tại trong danh mục Bộ Công An`,
      };
    }

    // Chữ số thứ 4: Thế kỷ sinh và giới tính
    const genderCenturyCode = parseInt(cleaned[3], 10);
    if (![0, 1, 2, 3].includes(genderCenturyCode)) {
      return {
        isValid: false,
        error: `Ký tự thế kỷ/giới tính '${cleaned[3]}' không đúng quy chuẩn (chỉ chấp nhận thế kỷ 20 và 21)`,
      };
    }

    const gender: 'Nam' | 'Nữ' = genderCenturyCode % 2 === 0 ? 'Nam' : 'Nữ';
    const century = genderCenturyCode <= 1 ? 1900 : 2000;
    const yearPart = parseInt(cleaned.slice(4, 6), 10);
    const birthYear = century + yearPart;

    // Kiểm tra độ tuổi (chủ nhà phải từ 18 tuổi trở lên, tính đến 2026)
    const currentYear = new Date().getFullYear();
    const age = currentYear - birthYear;
    if (age < 18) {
      return {
        isValid: false,
        error: `Chủ nhà phải từ đủ 18 tuổi trở lên (Năm sinh trích xuất từ CCCD: ${birthYear})`,
      };
    }
    if (age > 105) {
      return {
        isValid: false,
        error: `Năm sinh trích xuất từ CCCD (${birthYear}) không hợp lý`,
      };
    }

    // Kiểm tra 6 chữ số ngẫu nhiên cuối không được là chuỗi lặp / giả lập test
    const randomPart = cleaned.slice(6);
    if (/^(\d)\1{5}$/.test(randomPart) || randomPart === '123456' || randomPart === '654321') {
      return {
        isValid: false,
        error: `Dãy số cuối '${randomPart}' có dấu hiệu là số giả lập / thử nghiệm`,
      };
    }

    return {
      isValid: true,
      provinceName,
      birthYear,
      gender,
    };
  }

  /**
   * 2. Tải và nạp dữ liệu ảnh từ URL sang Buffer
   */
  async fetchImageBuffer(url: string): Promise<Buffer> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        throw new BadRequestException(`Không thể tải ảnh từ URL: HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length < 15 * 1024) {
        throw new BadRequestException('Ảnh tải lên có dung lượng quá nhỏ (< 15KB), không đạt chuẩn ảnh CCCD');
      }

      return buffer;
    } catch (err: any) {
      this.logger.error(`Lỗi tải ảnh từ URL ${url}: ${err.message}`);
      throw new BadRequestException(`Lỗi khi phân tích ảnh: ${err.message || 'Không thể đọc tệp ảnh'}`);
    }
  }

  /**
   * 3. Chuẩn hóa chuỗi tiếng Việt không dấu để so khớp
   */
  private normalizeString(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 4. Quét OCR và phân tích chống giả mạo trên ảnh thẻ
   */
  async scanAndAnalyzeCccd(
    imageUrl: string,
    side: 'FRONT' | 'BACK',
  ): Promise<{
    rawText: string;
    extractedCccd?: string;
    extractedName?: string;
    extractedBirthDate?: string;
    isAuthentic: boolean;
    fraudWarnings: string[];
  }> {
    const buffer = await this.fetchImageBuffer(imageUrl);
    const fraudWarnings: string[] = [];

    // Chạy nhận diện OCR bằng Tesseract.js
    let ocrResultText = '';
    try {
      const ocrOutput = await Tesseract.recognize(buffer, 'eng', {
        logger: () => {},
      });
      ocrResultText = ocrOutput?.data?.text || '';
    } catch (err: any) {
      this.logger.warn(`Lỗi OCR Tesseract: ${err.message}`);
    }

    const normalizedText = this.normalizeString(ocrResultText);

    // A. Kiểm tra từ khóa giả mạo / phôi mẫu demo trên mạng
    for (const keyword of FAKE_SAMPLE_KEYWORDS) {
      if (normalizedText.includes(keyword)) {
        fraudWarnings.push(`Phát hiện từ khóa nghi vấn làm giả / phôi mẫu: "${keyword}"`);
      }
    }

    // B. Kiểm tra sự hiện diện của từ khóa bảo chứng Căn Cước Công Dân
    const requiredKeywords =
      side === 'FRONT' ? FRONT_CARD_REQUIRED_KEYWORDS : BACK_CARD_REQUIRED_KEYWORDS;

    const matchedKeywords = requiredKeywords.filter((kw) => normalizedText.includes(kw));

    // Nếu không khớp từ khóa đặc trưng nào -> Không phải ảnh CCCD
    if (matchedKeywords.length === 0) {
      fraudWarnings.push(
        side === 'FRONT'
          ? 'Ảnh mặt trước không chứa các thông tin đặc trưng của thẻ Căn cước công dân Việt Nam (Không tìm thấy quốc hiệu hoặc tiêu đề thẻ)'
          : 'Ảnh mặt sau không chứa các đặc trưng nhận dạng của thẻ CCCD (Dấu vân tay, dải mã hoặc con chip)',
      );
    }

    // C. Bóc tách số CCCD (12 chữ số) trên ảnh mặt trước
    let extractedCccd: string | undefined;
    if (side === 'FRONT') {
      // Tìm dãy 12 số liên tiếp
      const cccdMatch = normalizedText.match(/\b\d{12}\b/);
      if (cccdMatch) {
        extractedCccd = cccdMatch[0];
      } else {
        // Tìm dãy số có khoảng trắng ở giữa (VD: 038 099 001234)
        const spacedMatch = normalizedText.match(/\b(\d{3})\s*(\d{1})\s*(\d{2})\s*(\d{6})\b/);
        if (spacedMatch) {
          extractedCccd = `${spacedMatch[1]}${spacedMatch[2]}${spacedMatch[3]}${spacedMatch[4]}`;
        }
      }
    }

    // D. Bóc tách Họ và Tên (dòng chữ hoa sau 'HO VA TEN' hoặc 'FULL NAME')
    let extractedName: string | undefined;
    if (side === 'FRONT') {
      const lines = ocrResultText.split('\n').map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const normLine = this.normalizeString(lines[i]);
        if (
          normLine.includes('HO VA TEN') ||
          normLine.includes('FULL NAME') ||
          normLine.includes('HO TEN')
        ) {
          // Họ tên thường nằm cùng dòng hoặc dòng tiếp theo
          const afterKeyword = normLine
            .replace(/.*HO VA TEN[:\s]*/, '')
            .replace(/.*FULL NAME[:\s]*/, '')
            .trim();
          if (afterKeyword.length >= 3 && /^[A-Z\s]+$/.test(afterKeyword)) {
            extractedName = afterKeyword;
            break;
          } else if (i + 1 < lines.length) {
            const nextLineNorm = this.normalizeString(lines[i + 1]);
            if (nextLineNorm.length >= 3 && /^[A-Z\s]+$/.test(nextLineNorm)) {
              extractedName = nextLineNorm;
              break;
            }
          }
        }
      }
    }

    // E. Bóc tách ngày sinh (DD/MM/YYYY)
    let extractedBirthDate: string | undefined;
    const dateMatch = normalizedText.match(/\b(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})\b/);
    if (dateMatch) {
      extractedBirthDate = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
    }

    return {
      rawText: ocrResultText,
      extractedCccd,
      extractedName,
      extractedBirthDate,
      isAuthentic: fraudWarnings.length === 0,
      fraudWarnings,
    };
  }

  /**
   * 5. Toàn bộ quy trình thẩm định eKYC chống giả mạo toàn diện
   */
  async verifyFullCccdPipeline(data: {
    front_image_url: string;
    back_image_url: string;
    cccd_number: string;
    full_name: string;
  }): Promise<{
    passed: boolean;
    frontAnalysis: any;
    backAnalysis: any;
    matchedCccd: boolean;
    matchedName: boolean;
  }> {
    // 1. Kiểm tra 2 mặt không được trùng nhau
    if (data.front_image_url.trim() === data.back_image_url.trim()) {
      throw new BadRequestException('Ảnh mặt trước và mặt sau thẻ CCCD không được trùng lặp một ảnh!');
    }

    // 2. Kiểm tra tính hợp lệ cấu trúc 12 số CCCD người dùng nhập
    const structCheck = this.validateCccdStructure(data.cccd_number);
    if (!structCheck.isValid) {
      throw new BadRequestException(
        `Thẩm định số CCCD thất bại: ${structCheck.error || 'Số CCCD không đúng quy chuẩn quốc gia'}`,
      );
    }

    this.logger.log(
      `[eKYC OCR] Bắt đầu quét & kiểm tra ảnh CCCD: Số ${data.cccd_number} (Tỉnh: ${structCheck.provinceName}, Sinh năm: ${structCheck.birthYear})`,
    );

    // 3. Quét OCR và phân tích chống giả ảnh Mặt Trước
    const frontAnalysis = await this.scanAndAnalyzeCccd(data.front_image_url, 'FRONT');
    if (!frontAnalysis.isAuthentic) {
      throw new BadRequestException(
        `Thẩm định Mặt Trước CCCD thất bại: ${frontAnalysis.fraudWarnings.join('; ')}`,
      );
    }

    // 4. Quét OCR và phân tích chống giả ảnh Mặt Sau
    const backAnalysis = await this.scanAndAnalyzeCccd(data.back_image_url, 'BACK');
    if (!backAnalysis.isAuthentic) {
      throw new BadRequestException(
        `Thẩm định Mặt Sau CCCD thất bại: ${backAnalysis.fraudWarnings.join('; ')}`,
      );
    }

    // 5. So khớp số CCCD nếu OCR trích xuất được từ ảnh
    let matchedCccd = true;
    if (frontAnalysis.extractedCccd) {
      if (frontAnalysis.extractedCccd !== data.cccd_number.trim()) {
        throw new BadRequestException(
          `Cảnh báo giả mạo: Số CCCD quét được trên ảnh (${frontAnalysis.extractedCccd}) không trùng khớp với số CCCD bạn khai báo (${data.cccd_number})!`,
        );
      }
    }

    // 6. So khớp họ tên nếu OCR trích xuất được từ ảnh
    let matchedName = true;
    if (frontAnalysis.extractedName) {
      const normalizedInputName = this.normalizeString(data.full_name);
      const isIncluded =
        frontAnalysis.extractedName.includes(normalizedInputName) ||
        normalizedInputName.includes(frontAnalysis.extractedName);
      if (!isIncluded) {
        throw new BadRequestException(
          `Cảnh báo giả mạo: Họ tên nhận diện trên ảnh thẻ (${frontAnalysis.extractedName}) không trùng khớp với tên khai báo (${data.full_name})!`,
        );
      }
    }

    return {
      passed: true,
      frontAnalysis,
      backAnalysis,
      matchedCccd,
      matchedName,
    };
  }
}
