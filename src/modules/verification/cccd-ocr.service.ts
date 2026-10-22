import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
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
  personal_identification?: string;
  issue_date?: string;
  mrz_code?: string;
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
  'WATERMARK',
  'SHUTTERSTOCK',
  'FREEPIK',
  'GETTYIMAGES',
  'PNGTREE',
  'VECTOR',
  'DOWNLOAD',
];

// Từ khóa bảo chứng bắt buộc của thẻ CCCD mặt trước (tối thiểu 2 cụm từ)
const FRONT_CARD_REQUIRED_KEYWORDS = [
  'CONG HOA XA HOI',
  'CỘNG HÒA XÃ HỘI',
  'DOC LAP TU DO',
  'ĐỘC LẬP TỰ DO',
  'CAN CUOC CONG DAN',
  'CĂN CƯỚC CÔNG DÂN',
  'THE CAN CUOC',
  'THẺ CĂN CƯỚC',
  'CITIZEN IDENTITY CARD',
  'HO VA TEN',
  'HỌ VÀ TÊN',
  'FULL NAME',
  'NGAY SINH',
  'NGÀY SINH',
  'DATE OF BIRTH',
  'GIOI TINH',
  'GIỚI TÍNH',
  'QUOC TICH',
  'QUỐC TỊCH',
  'QUE QUAN',
  'QUÊ QUÁN',
  'NOI THUONG TRU',
  'NƠI THƯỜNG TRÚ',
  'GIA TRI DEN',
  'GIÁ TRỊ ĐẾN',
];

// Từ khóa bảo chứng mặt sau (tối thiểu 1 cụm từ hoặc dải mã MRZ)
const BACK_CARD_REQUIRED_KEYWORDS = [
  'DAC DIEM NHAN DANG',
  'ĐẶC ĐIỂM NHẬN DẠNG',
  'DAU VET RIENG',
  'DẤU VẾT RIÊNG',
  'PERSONAL IDENTIFICATION',
  'NGON TRO',
  'NGÓN TRỎ',
  'BO CONG AN',
  'BỘ CÔNG AN',
  'CUC CANH SAT',
  'CỤC CẢNH SÁT',
  'NGAY THANG NAM',
  'NGÀY THÁNG NĂM',
  'NGAY CAP',
  'NGÀY CẤP',
  'DIRECTOR GENERAL',
  'IDVNM',
  '<<',
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
    const cleaned = (cccdNumber || '').trim();
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
   * 2. Tải và nạp dữ liệu ảnh từ URL, Base64 hoặc File cục bộ sang Buffer
   */
  async fetchImageBuffer(urlOrBase64: string): Promise<Buffer> {
    if (!urlOrBase64 || typeof urlOrBase64 !== 'string') {
      throw new BadRequestException('Dữ liệu ảnh không hợp lệ (chuỗi trống)');
    }

    const trimmed = urlOrBase64.trim();

    // 2.1. Dữ liệu base64 (Data URI hoặc chuỗi base64 thuần)
    if (
      trimmed.startsWith('data:image/') ||
      trimmed.startsWith('data:application/octet-stream') ||
      trimmed.startsWith('data:;base64,') ||
      trimmed.startsWith('/9j/') ||
      trimmed.startsWith('iVBORw0KGgo') ||
      (!trimmed.startsWith('http') && !trimmed.includes('/') && trimmed.length > 500)
    ) {
      try {
        const base64Data = trimmed.includes(',') ? trimmed.split(',')[1] : trimmed;
        const buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length < 2 * 1024) {
          throw new BadRequestException('Ảnh tải lên có dung lượng quá nhỏ (< 2KB), không đạt chuẩn ảnh CCCD');
        }
        return buffer;
      } catch (err: any) {
        if (err instanceof BadRequestException) throw err;
        throw new BadRequestException(`Lỗi giải mã ảnh base64: ${err.message}`);
      }
    }

    // 2.2. Kiểm tra file cục bộ trong thư mục uploads/cccd/
    const uploadDir = path.resolve(process.cwd(), 'uploads', 'cccd');
    const cccdMatch = trimmed.match(/cccd_[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)/i);
    if (cccdMatch) {
      const localFilePath = path.join(uploadDir, cccdMatch[0]);
      if (fs.existsSync(localFilePath)) {
        this.logger.log(`[OCR Buffer] Đọc ảnh trực tiếp từ bộ nhớ đĩa: ${localFilePath}`);
        return fs.readFileSync(localFilePath);
      }
    }

    if (fs.existsSync(trimmed)) {
      this.logger.log(`[OCR Buffer] Đọc ảnh từ file path: ${trimmed}`);
      return fs.readFileSync(trimmed);
    }

    // 2.3. URL mạng (Cloudinary, AWS S3, External HTTP/HTTPS)
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      if (trimmed.includes('/files/')) {
        const parts = trimmed.split('/files/');
        if (parts[1]) {
          const fname = path.basename(parts[1].split('?')[0]);
          const localPath = path.join(uploadDir, fname);
          if (fs.existsSync(localPath)) {
            this.logger.log(`[OCR Buffer] Đọc ảnh cục bộ từ URL nội bộ: ${localPath}`);
            return fs.readFileSync(localPath);
          }
        }
      }

      try {
        const response = await fetch(trimmed, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StayAI/1.0',
            Accept: 'image/*,*/*',
          },
          signal: AbortSignal.timeout(20000),
        });

        if (!response.ok) {
          throw new BadRequestException(`Không thể tải ảnh từ URL: HTTP ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length < 5 * 1024) {
          throw new BadRequestException('Ảnh tải về có dung lượng quá nhỏ (< 5KB), không đạt chuẩn ảnh CCCD');
        }

        return buffer;
      } catch (err: any) {
        this.logger.error(`Lỗi tải ảnh từ URL ${trimmed}: ${err.message}`);
        throw new BadRequestException(`Lỗi khi tải ảnh để phân tích: ${err.message || 'Không thể đọc tệp ảnh từ URL'}`);
      }
    }

    if (trimmed.length > 500 && /^[A-Za-z0-9+/=]+$/.test(trimmed.slice(0, 100))) {
      try {
        return Buffer.from(trimmed, 'base64');
      } catch {
        // bỏ qua
      }
    }

    throw new BadRequestException('Định dạng ảnh hoặc URL không hợp lệ');
  }

  /**
   * 3. Chuẩn hóa chuỗi tiếng Việt không dấu để so khớp từ khóa
   */
  private normalizeString(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toUpperCase()
      .replace(/[^A-Z0-9\s<]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 4. Bóc tách chi tiết các trường thông tin từ văn bản OCR của 2 mặt thẻ
   */
  parseCccdText(frontRawText: string, backRawText: string = ''): ExtractedCccdData {
    let front = (frontRawText || '').trim();
    let back = (backRawText || '').trim();

    // Tự động phát hiện nếu người dùng nạp ngược ảnh mặt sau vào mặt trước
    const frontHasBackClues = /IDVNM|DIRECTOR GENERAL|CỤC CẢNH SÁT|CUC CANH SAT|NGÓN TRỎ|NGON TRO/i.test(front);
    const backHasFrontClues = /CĂN CƯỚC CÔNG DÂN|CAN CUOC CONG DAN|Họ và tên|Full name/i.test(back);
    if (frontHasBackClues && !backHasFrontClues && !front.includes('CĂN CƯỚC CÔNG DÂN')) {
      const temp = front;
      front = back;
      back = temp;
    }

    const combinedText = `${front}\n${back}`;

    const data: ExtractedCccdData = {
      cccd_number: '',
      full_name: '',
      date_of_birth: '',
      gender: '',
      nationality: 'Việt Nam',
      place_of_origin: '',
      place_of_residence: '',
      expiry_date: '',
      personal_identification: 'Không có dấu vết dị hình riêng biệt',
      issue_date: '',
      mrz_code: '',
      raw_text: `${front}\n---\n${back}`,
    };

    const frontLines = front.split('\n').map((l) => l.trim()).filter(Boolean);
    const backLines = back.split('\n').map((l) => l.trim()).filter(Boolean);

    // ==========================================
    // 1. GIẢI MÃ DẢI MÃ MRZ MẶT SAU (ICAO 9303 - 3 DÒNG)
    // ==========================================
    const mrzLines = combinedText
      .split('\n')
      .map((l) => l.trim().replace(/\s+/g, ''))
      .filter((l) => l.includes('IDVNM') || l.includes('<<') || /^[A-Z0-9<]{25,36}$/.test(l));

    if (mrzLines.length > 0) {
      data.mrz_code = mrzLines.join('\n');

      // MRZ Dòng 1: IDVNM...
      const line1 = mrzLines.find((l) => l.startsWith('IDVNM'));
      if (line1) {
        const match12 = line1.match(/(\d{12})<{0,2}\d?$/) || line1.match(/\d{12}/);
        if (match12) {
          data.cccd_number = match12[1] || match12[0];
        }
      }

      // MRZ Dòng 2: YYMMDD + Sex + YYMMDD + VNM
      const line2 = mrzLines.find((l) => /^[0-9]{6,7}[MF]/i.test(l) || l.includes('VNM'));
      if (line2) {
        const sexMatch = line2.match(/([0-9]{6})[0-9]?([MF])([0-9]{6})/i);
        if (sexMatch) {
          const rawDob = sexMatch[1];
          const sexChar = sexMatch[2].toUpperCase();
          const rawExp = sexMatch[3];

          if (!data.gender) data.gender = sexChar === 'M' ? 'Nam' : 'Nữ';

          if (!data.date_of_birth && rawDob.length === 6) {
            const yy = parseInt(rawDob.slice(0, 2), 10);
            const mm = rawDob.slice(2, 4);
            const dd = rawDob.slice(4, 6);
            data.date_of_birth = `${dd}/${mm}/${yy > 30 ? 1900 + yy : 2000 + yy}`;
          }

          if (!data.expiry_date && rawExp.length === 6) {
            const yy = parseInt(rawExp.slice(0, 2), 10);
            const mm = rawExp.slice(2, 4);
            const dd = rawExp.slice(4, 6);
            data.expiry_date = `${dd}/${mm}/${yy > 50 ? 1900 + yy : 2000 + yy}`;
          }
        }
      }

      // MRZ Dòng 3: Tên Latin ICAO (VD: PHUNG<<HAI<NAM<<<<)
      const line3 = mrzLines.find(
        (l) => l.includes('<<') && /^[A-Z<]+$/.test(l) && !l.includes('IDVNM') && !l.includes('VNM'),
      );
      if (line3) {
        const cleanName = line3.replace(/<+/g, ' ').trim();
        if (cleanName.length >= 3) {
          data.full_name = cleanName;
        }
      }
    }

    // ==========================================
    // 2. SỐ CCCD TỪ MẶT TRƯỚC (HOẶC VĂN BẢN TỔNG HỢP)
    // ==========================================
    const cccdMatch =
      front.match(/\b\d{12}\b/) ||
      combinedText.match(/\b\d{12}\b/) ||
      combinedText.match(/(?:Số|So|No|sé\/nvo|sé|só)[:\s\.]*(\d{12})/i) ||
      combinedText.match(/(\d{3})\s*(\d{1})\s*(\d{2})\s*(\d{6})/);
    if (cccdMatch) {
      data.cccd_number = (cccdMatch[1] || cccdMatch[0]).replace(/\s+/g, '');
    }

    // ==========================================
    // 3. HỌ VÀ TÊN TIẾNG VIỆT CÓ DẤU TỪ MẶT TRƯỚC
    // ==========================================
    for (let i = 0; i < frontLines.length; i++) {
      const line = frontLines[i];
      if (/Họ và tên|Full name|Họ tên/i.test(line)) {
        let candidate = line.replace(/.*(?:Họ và tên|Full name|Họ tên)[:\s\.\-]*/i, '').trim();
        if (!candidate && i + 1 < frontLines.length) {
          candidate = frontLines[i + 1].trim();
        }
        // Loại bỏ từ nhiễu OCR đầu dòng (như "sảng ", "ng ", "1 ", "- ")
        candidate = candidate.replace(/^[a-zà-ỹ0-9\s\-\.\:\/]+/g, '').trim();
        candidate = candidate.replace(/[\.\:\-\/].*$/, '').trim();

        if (candidate.length >= 3 && /^[A-ZÀ-Ỹ\s]+$/.test(candidate) && !/Ngày|Date|Sinh|Giới/i.test(candidate)) {
          data.full_name = candidate;
          break;
        }
      }
    }

    // ==========================================
    // 4. NGÀY SINH (DD/MM/YYYY)
    // ==========================================
    const dobMatch =
      front.match(/(?:Ngày sinh|Date of birth|Sinh ngày)[:\s\.\-]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i) ||
      front.match(/\b(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\b/) ||
      combinedText.match(/\b(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\b/);
    if (dobMatch) {
      data.date_of_birth = dobMatch[1].replace(/[\-\.]/g, '/');
    }

    // ==========================================
    // 5. GIỚI TÍNH (Nam / Nữ)
    // ==========================================
    if (/Giới tính.*Nam|Sex.*Nam|Sex.*M\b/i.test(combinedText)) {
      data.gender = 'Nam';
    } else if (/Giới tính.*Nữ|Sex.*Female|Sex.*F\b/i.test(combinedText)) {
      data.gender = 'Nữ';
    } else if (data.cccd_number && data.cccd_number.length === 12) {
      const gCode = parseInt(data.cccd_number[3], 10);
      data.gender = gCode % 2 === 0 ? 'Nam' : 'Nữ';
    }

    // ==========================================
    // 6. QUỐC TỊCH
    // ==========================================
    data.nationality = 'Việt Nam';

    // ==========================================
    // 7. QUÊ QUÁN (Place of origin)
    // ==========================================
    for (let i = 0; i < frontLines.length; i++) {
      const line = frontLines[i];
      if (/Quê quán|Place of origin/i.test(line)) {
        let origin = line.replace(/.*(?:Quê quán|Place of origin)[:\s\.\-~]*/i, '').trim();
        if (!origin && i + 1 < frontLines.length) {
          origin = frontLines[i + 1].replace(/^[~~\-\.\s]*/, '').trim();
        }
        if (origin) {
          data.place_of_origin = origin.replace(/[~_]+$/g, '').trim();
          break;
        }
      }
    }

    // ==========================================
    // 8. NƠI THƯỜNG TRÚ (Place of residence)
    // ==========================================
    for (let i = 0; i < frontLines.length; i++) {
      const line = frontLines[i];
      if (/Nơi thường trú|Place of residence/i.test(line)) {
        let res = line.replace(/.*(?:Nơi thường trú|Place of residence|Pisoe.*?residence)[:\s\.\-]*/i, '').trim();
        let extra = '';
        if (i + 1 < frontLines.length && !/Có giá trị|Date of/i.test(frontLines[i + 1])) {
          extra = ' ' + frontLines[i + 1].replace(/^.*?(?:Nó\s*_|[\-_])\s*/, '').trim();
        } else if (i + 2 < frontLines.length && !/Có giá trị|Date of/i.test(frontLines[i + 2])) {
          extra = ' ' + frontLines[i + 2].replace(/^.*?(?:Nó\s*_|[\-_])\s*/, '').trim();
        }
        res = (res + extra).replace(/[~_]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (res) {
          data.place_of_residence = res;
          break;
        }
      }
    }

    // ==========================================
    // 9. CÓ GIÁ TRỊ ĐẾN (HẠN SỬ DỤNG)
    // ==========================================
    const expMatch = front.match(/(?:Có giá trị đến|Date of expiry)[:\s\.\-]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
    if (expMatch) {
      data.expiry_date = expMatch[1].replace(/[\-\.]/g, '/');
    }

    // ==========================================
    // 10. ĐẶC ĐIỂM NHẬN DẠNG (MẶT SAU)
    // ==========================================
    const featMatch =
      back.match(/(?:Đặc điểm nhận dạng|Dấu vết riêng|Personal identification)[:\s\.\-]*(.+?)(?=\n|$)/i);
    if (featMatch && featMatch[1].trim().length > 3) {
      data.personal_identification = featMatch[1].trim();
    }

    // ==========================================
    // 11. NGÀY CẤP (MẶT SAU)
    // ==========================================
    const issueMatch =
      back.match(/(?:Ngày,?\s*tháng,?\s*năm|Date,?\s*month,?\s*year|Ngày cấp|Cấp ngày)[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/i) ||
      back.match(/(?:year|năm)(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i) ||
      back.match(/(?:Ngày|Ngay)\s*(\d{1,2})\s*(?:tháng|thang)\s*(\d{1,2})\s*(?:năm|nam)\s*(\d{4})/i);

    if (issueMatch) {
      if (issueMatch[3]) {
        data.issue_date = `${issueMatch[1].padStart(2, '0')}/${issueMatch[2].padStart(2, '0')}/${issueMatch[3]}`;
      } else {
        data.issue_date = issueMatch[1].replace(/[\-\.]/g, '/');
      }
    }

    return data;
  }

  /**
   * 5. Quét OCR và phân tích chống giả mạo trên ảnh thẻ (Mặt trước / Mặt sau)
   */
  async scanAndAnalyzeCccd(
    imageUrl: string,
    side: 'FRONT' | 'BACK',
  ): Promise<{
    rawText: string;
    extractedData: ExtractedCccdData;
    isAuthentic: boolean;
    fraudWarnings: string[];
  }> {
    const buffer = await this.fetchImageBuffer(imageUrl);
    const fraudWarnings: string[] = [];

    // Chạy nhận diện OCR bằng Tesseract.js (sử dụng vie+eng)
    let ocrResultText = '';
    try {
      const ocrOutput = await Tesseract.recognize(buffer, 'vie+eng', {
        logger: () => {},
      });
      ocrResultText = ocrOutput?.data?.text || '';
    } catch {
      // Fallback về eng nếu vie gặp sự cố
      try {
        const ocrOutputEng = await Tesseract.recognize(buffer, 'eng', {
          logger: () => {},
        });
        ocrResultText = ocrOutputEng?.data?.text || '';
      } catch (err: any) {
        this.logger.warn(`Lỗi OCR Tesseract: ${err.message}`);
      }
    }

    const normalizedText = this.normalizeString(ocrResultText);

    // A. Kiểm tra từ khóa giả mạo / phôi mẫu demo trên mạng
    for (const keyword of FAKE_SAMPLE_KEYWORDS) {
      if (normalizedText.includes(keyword)) {
        fraudWarnings.push(`Phát hiện từ khóa nghi vấn làm giả / phôi mẫu: "${keyword}"`);
      }
    }

    // B. Bóc tách dữ liệu
    const extractedData = this.parseCccdText(
      side === 'FRONT' ? ocrResultText : '',
      side === 'BACK' ? ocrResultText : '',
    );

    // C. KIỂM SOÁT TÍNH CHÍNH XÁC & BẢO CHỨNG THEO TỪNG MẶT THẺ
    if (side === 'FRONT') {
      const matchedKeywords = FRONT_CARD_REQUIRED_KEYWORDS.filter((kw) =>
        normalizedText.includes(kw),
      );

      // Ảnh mặt trước phải khớp tối thiểu 2 từ khóa đặc trưng của Quốc hiệu/CCCD hoặc có số CCCD hợp lệ
      if (matchedKeywords.length < 2 && !extractedData.cccd_number) {
        fraudWarnings.push(
          'Ảnh mặt trước không chứa các thông tin đặc trưng của thẻ Căn cước công dân Việt Nam (Thiếu Quốc hiệu, tiêu đề thẻ CCCD hoặc các mục định danh)',
        );
      }

      // BẮT BUỘC: Ảnh mặt trước phải đọc được số CCCD 12 số hợp lệ
      if (!extractedData.cccd_number) {
        fraudWarnings.push(
          'Không tìm thấy số Căn cước công dân (12 chữ số) hợp lệ trên ảnh. Ảnh không phải là mặt trước CCCD hoặc ảnh quá mờ!',
        );
      } else {
        const structCheck = this.validateCccdStructure(extractedData.cccd_number);
        if (!structCheck.isValid) {
          fraudWarnings.push(`Số CCCD trích xuất (${extractedData.cccd_number}) không hợp lệ: ${structCheck.error}`);
        }
      }
    } else {
      // Mặt sau: Phải khớp ít nhất 1 đặc trưng của mặt sau
      const matchedBackKeywords = BACK_CARD_REQUIRED_KEYWORDS.filter((kw) =>
        normalizedText.includes(kw),
      );

      const hasBackFeatures =
        matchedBackKeywords.length > 0 ||
        Boolean(extractedData.personal_identification) ||
        Boolean(extractedData.issue_date) ||
        Boolean(extractedData.mrz_code);

      if (!hasBackFeatures) {
        fraudWarnings.push(
          'Ảnh không phải là mặt sau thẻ Căn cước công dân (Không tìm thấy đặc điểm nhận dạng, ngày cấp, con chip hoặc dải mã MRZ)',
        );
      }
    }

    return {
      rawText: ocrResultText,
      extractedData,
      isAuthentic: fraudWarnings.length === 0,
      fraudWarnings,
    };
  }

  /**
   * 6. Quét OCR thông minh bằng Google Gemini Vision (Hỗ trợ luân chuyển đa mô hình 2.5 / 1.5 / 2.0 Flash)
   */
  async scanWithGeminiVision(
    frontBuffer: Buffer,
    backBuffer?: Buffer,
  ): Promise<{
    isAuthentic: boolean;
    extractedData: ExtractedCccdData;
    fraudWarnings: string[];
  } | null> {
    const apiKey = (
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      'AIzaSyAIy2zkqF9LQGf2R3Ba7MRh33scK47rf4g'
    ).trim();
    if (!apiKey) {
      return null;
    }

    try {
      this.logger.log(
        `[Gemini Vision OCR] Bắt đầu phân tích bóc tách CCCD bằng Google Gemini AI (${
          backBuffer ? 'Có cả 2 mặt trước & sau' : 'Chỉ có mặt trước'
        })...`,
      );

      const promptText = `Bạn là trợ lý AI cao cấp chuyên gia eKYC và thẩm định giấy tờ tuỳ thân Việt Nam.
Nhiệm vụ: Phân tích ảnh thẻ Căn cước công dân (CCCD) được cung cấp và trích xuất chính xác 100% tiếng Việt có dấu các trường thông tin.

YÊU CẦU QUAN TRỌNG:
1. Xác định xem ảnh có phải là thẻ Căn cước công dân Việt Nam thật hay không. Nếu ảnh là ảnh con vật, phong cảnh, đồ vật, selfie, hoặc tài liệu không phải CCCD: đặt "is_cccd": false và ghi rõ lý do vào "fraud_warnings".
2. ${
  backBuffer
    ? 'Bạn được cung cấp CẢ 2 MẶT CỦA THẺ CCCD (Mặt trước và Mặt sau). BẮT BUỘC BÓC TÁCH ĐỦ 10/10 TRƯỜNG DỮ LIỆU SAU:'
    : 'Bạn được cung cấp ẢNH MẶT TRƯỚC CCCD. Bóc tách tối đa 7 trường mặt trước:'
}
   - cccd_number: 12 chữ số định danh cá nhân (ở mặt trước)
   - full_name: Họ và tên viết hoa có dấu đầy đủ (ví dụ: PHÙNG HẢI NAM)
   - date_of_birth: Ngày tháng năm sinh định dạng DD/MM/YYYY (ví dụ: 03/10/2004)
   - gender: "Nam" hoặc "Nữ"
   - nationality: "Việt Nam"
   - place_of_origin: Quê quán đầy đủ tiếng Việt có dấu (ở mặt trước, ví dụ: Phú Đông, Ba Vì, Hà Nội)
   - place_of_residence: Nơi thường trú đầy đủ tiếng Việt có dấu (ở mặt trước, ví dụ: Xóm Thuận Trại, Phú Đông, Ba Vì, Hà Nội)
   - personal_identification: Đặc điểm nhận dạng riêng biệt (ở MẶT SAU thẻ, ví dụ: "Không có" hoặc "Nốt ruồi cách 1cm dưới sau đuôi mắt trái". Nếu không có ghi "Không có dấu vết dị hình riêng biệt")
   - issue_date: Ngày cấp thẻ định dạng DD/MM/YYYY (ở MẶT SAU thẻ, ví dụ: 20/07/2021)
   - expiry_date: Ngày hết hạn DD/MM/YYYY hoặc "Không thời hạn" (ở mặt trước)
   - mrz_code: Dải ký tự mã máy ICAO 9303 gồm 3 dòng ở đáy MẶT SAU thẻ (bắt đầu bằng IDVNM... ví dụ: "IDVNM2040329002001204032900<<3\\n0410056M2910035VNM<<<<<<<<<<<4\\nPHUNG<<HAI<NAM<<<<<<<<<<<<<<<<")

Trả về DUY NHẤT một đối tượng JSON hợp lệ theo cấu trúc sau (không kèm markdown \`\`\`json):
{
  "is_cccd": true,
  "fraud_warnings": [],
  "cccd_number": "001204032900",
  "full_name": "PHÙNG HẢI NAM",
  "date_of_birth": "03/10/2004",
  "gender": "Nam",
  "nationality": "Việt Nam",
  "place_of_origin": "Phú Đông, Ba Vì, Hà Nội",
  "place_of_residence": "Xóm Thuận Trại, Phú Đông, Ba Vì, Hà Nội",
  "personal_identification": "Không có dấu vết dị hình riêng biệt",
  "issue_date": "20/07/2021",
  "expiry_date": "03/10/2029",
  "mrz_code": "IDVNM..."
}`;

      const parts: any[] = [
        { text: promptText },
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: frontBuffer.toString('base64'),
          },
        },
      ];

      if (backBuffer) {
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: backBuffer.toString('base64'),
          },
        });
      }

      // Danh sách các mô hình Flash theo thứ tự ưu tiên luân chuyển khi gặp 429 / 503 / Timeout
      const candidateModels = [
        process.env.GEMINI_MODEL,
        'gemini-2.5-flash',
        'gemini-1.5-flash',
        'gemini-2.0-flash',
      ].filter((m, idx, arr): m is string => Boolean(m) && arr.indexOf(m) === idx);

      let parsed: any = null;
      let rawOutput = '';

      for (const model of candidateModels) {
        try {
          this.logger.log(`[Gemini Vision OCR] Đang thử bóc tách với model: ${model}...`);
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.1,
              },
            }),
            signal: AbortSignal.timeout(15000), // 15s timeout cho mỗi model
          });

          if (!response.ok) {
            const errorText = await response.text();
            this.logger.warn(
              `[Gemini Vision OCR] Model ${model} phản hồi HTTP ${response.status}: ${errorText.slice(0, 150)}. Tự động chuyển model kế tiếp...`,
            );
            continue;
          }

          const resJson: any = await response.json();
          rawOutput = resJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (!rawOutput) {
            this.logger.warn(`[Gemini Vision OCR] Model ${model} không có nội dung text trả về.`);
            continue;
          }

          // Cố gắng parse JSON với cơ chế làm sạch Markdown hoặc Regex
          try {
            const cleaned = rawOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleaned);
          } catch {
            const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            }
          }

          if (parsed && typeof parsed === 'object') {
            this.logger.log(`[Gemini Vision OCR] Model ${model} bóc tách thành công!`);
            break;
          }
        } catch (err: any) {
          this.logger.warn(`[Gemini Vision OCR] Model ${model} bị lỗi mạng/timeout: ${err.message}. Thử model kế tiếp...`);
        }
      }

      if (!parsed) {
        this.logger.error('[Gemini Vision OCR] Tất cả các model Gemini Flash đều không phản hồi kết quả hợp lệ.');
        return null;
      }

      const warnings: string[] = Array.isArray(parsed.fraud_warnings) ? parsed.fraud_warnings : [];
      if (!parsed.is_cccd) {
        warnings.push('Hình ảnh tải lên không phải là thẻ Căn cước công dân Việt Nam hợp lệ');
      }

      const extractedData: ExtractedCccdData = {
        cccd_number: String(parsed.cccd_number || '').trim(),
        full_name: String(parsed.full_name || '').trim().toUpperCase(),
        date_of_birth: String(parsed.date_of_birth || '').trim(),
        gender: parsed.gender === 'Nữ' ? 'Nữ' : 'Nam',
        nationality: String(parsed.nationality || 'Việt Nam').trim(),
        place_of_origin: String(parsed.place_of_origin || '').trim(),
        place_of_residence: String(parsed.place_of_residence || '').trim(),
        personal_identification: String(parsed.personal_identification || 'Không có dấu vết dị hình riêng biệt').trim(),
        issue_date: String(parsed.issue_date || '').trim(),
        expiry_date: String(parsed.expiry_date || '').trim(),
        mrz_code: String(parsed.mrz_code || '').trim(),
        raw_text: rawOutput,
      };

      if (extractedData.cccd_number) {
        const structCheck = this.validateCccdStructure(extractedData.cccd_number);
        if (!structCheck.isValid) {
          warnings.push(`Số CCCD (${extractedData.cccd_number}) không hợp lệ: ${structCheck.error}`);
        }
      } else {
        warnings.push('Không đọc được số định danh cá nhân 12 chữ số trên ảnh');
      }

      this.logger.log(
        `[Gemini Vision OCR] Bóc tách hoàn tất: CCCD=${extractedData.cccd_number}, Tên=${extractedData.full_name}, Ngày sinh=${extractedData.date_of_birth}`,
      );

      return {
        isAuthentic: warnings.length === 0,
        extractedData,
        fraudWarnings: warnings,
      };
    } catch (err: any) {
      this.logger.error(`[Gemini Vision OCR] Ngoại lệ tổng quát khi gọi Gemini: ${err.message}`);
      return null;
    }
  }

  /**
   * 7. Quét đồng thời cả 2 mặt và bóc tách đầy đủ 10 trường thông tin CCCD
   */
  async scanBothSides(frontImageUrl: string, backImageUrl?: string): Promise<{
    isAuthentic: boolean;
    extractedData: ExtractedCccdData;
    fraudWarnings: string[];
    frontAnalysis: any;
    backAnalysis?: any;
  }> {
    // 7.1. Ưu tiên quét bằng Multimodal AI Gemini nếu có cấu hình API Key
    try {
      const frontBuf = await this.fetchImageBuffer(frontImageUrl);
      const backBuf = backImageUrl ? await this.fetchImageBuffer(backImageUrl) : undefined;
      const geminiResult = await this.scanWithGeminiVision(frontBuf, backBuf);
      if (geminiResult) {
        this.logger.log('[OCR Pipeline] Đã hoàn thành thẩm định và bóc tách bằng Gemini AI Vision.');
        return {
          isAuthentic: geminiResult.isAuthentic,
          extractedData: geminiResult.extractedData,
          fraudWarnings: geminiResult.fraudWarnings,
          frontAnalysis: { rawText: geminiResult.extractedData.raw_text, fraudWarnings: geminiResult.fraudWarnings },
          backAnalysis: undefined,
        };
      }
    } catch (err: any) {
      this.logger.warn(`[OCR Pipeline] Gemini Vision không khả dụng, chuyển sang Tesseract fallback: ${err.message}`);
    }

    // 7.2. Fallback sang Tesseract OCR + MRZ Parsing truyền thống
    this.logger.warn('[OCR Pipeline] Đang kích hoạt bộ quét Tesseract CPU fallback...');
    const frontAnalysis = await this.scanAndAnalyzeCccd(frontImageUrl, 'FRONT');
    let backAnalysis: any = undefined;
    const allWarnings: string[] = [
      '⚠️ AI Gemini tạm thời bận hoặc quá tải, hệ thống đã dùng bộ quét OCR dự phòng. Hãy nhấn "Quét lại bằng AI" sau vài giây để trích xuất đầy đủ 10/10 trường.',
    ];

    let frontRaw = frontAnalysis.rawText || '';
    let backRaw = '';

    if (backImageUrl) {
      if (frontImageUrl.trim() === backImageUrl.trim()) {
        allWarnings.push('Ảnh mặt trước và mặt sau thẻ CCCD không được trùng lặp một ảnh!');
      } else {
        backAnalysis = await this.scanAndAnalyzeCccd(backImageUrl, 'BACK');
        backRaw = backAnalysis.rawText || '';
      }
    }

    // Bóc tách tổng hợp chéo dữ liệu từ cả 2 mặt thẻ
    const combinedData = this.parseCccdText(frontRaw, backRaw);

    // Kiểm tra tính hợp lệ toán học của số CCCD tổng hợp
    if (!combinedData.cccd_number) {
      allWarnings.push(
        'Không tìm thấy số Căn cước công dân (12 chữ số) hợp lệ trên ảnh. Vui lòng tải ảnh chụp thẻ CCCD thật, rõ nét!',
      );
    } else {
      const structCheck = this.validateCccdStructure(combinedData.cccd_number);
      if (!structCheck.isValid) {
        allWarnings.push(`Số CCCD (${combinedData.cccd_number}) không hợp lệ: ${structCheck.error}`);
      }
    }

    // Kiểm tra từ khóa giả mạo nếu có
    if (frontAnalysis.fraudWarnings.length > 0) {
      for (const w of frontAnalysis.fraudWarnings) {
        if (!allWarnings.includes(w)) allWarnings.push(w);
      }
    }
    if (backAnalysis && backAnalysis.fraudWarnings.length > 0) {
      for (const w of backAnalysis.fraudWarnings) {
        if (!allWarnings.includes(w)) allWarnings.push(w);
      }
    }

    return {
      isAuthentic: allWarnings.length <= 1, // Chỉ có cảnh báo fallback AI thì vẫn cho phép tiếp tục
      extractedData: combinedData,
      fraudWarnings: allWarnings,
      frontAnalysis,
      backAnalysis,
    };
  }

  /**
   * 7. Toàn bộ quy trình thẩm định eKYC chống giả mạo toàn diện khi Submit
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
    extractedData: ExtractedCccdData;
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
      `[eKYC OCR] Bắt đầu thẩm định thẻ CCCD Số ${data.cccd_number} (Tỉnh: ${structCheck.provinceName}, Sinh năm: ${structCheck.birthYear})`,
    );

    // Ưu tiên thẩm định bằng Gemini Vision nếu có cấu hình
    try {
      const frontBuf = await this.fetchImageBuffer(data.front_image_url);
      const backBuf = await this.fetchImageBuffer(data.back_image_url);
      const geminiResult = await this.scanWithGeminiVision(frontBuf, backBuf);
      if (geminiResult) {
        if (!geminiResult.isAuthentic) {
          throw new BadRequestException(`Thẩm định ảnh CCCD thất bại: ${geminiResult.fraudWarnings.join('; ')}`);
        }
        const extractedCccd = geminiResult.extractedData?.cccd_number;
        if (extractedCccd && extractedCccd !== data.cccd_number.trim()) {
          throw new BadRequestException(
            `Cảnh báo sai lệch: Số CCCD nhận diện trên ảnh (${extractedCccd}) không trùng khớp với số CCCD bạn khai báo (${data.cccd_number})!`,
          );
        }
        return {
          passed: true,
          frontAnalysis: { isAuthentic: true, rawText: geminiResult.extractedData.raw_text },
          backAnalysis: { isAuthentic: true },
          matchedCccd: true,
          matchedName: true,
          extractedData: geminiResult.extractedData,
        };
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`[eKYC Pipeline] Gemini Vision fallback sang Tesseract: ${err.message}`);
    }

    // 3. Quét OCR và kiểm tra tính nguyên bản ảnh Mặt Trước
    const frontAnalysis = await this.scanAndAnalyzeCccd(data.front_image_url, 'FRONT');
    if (!frontAnalysis.isAuthentic) {
      throw new BadRequestException(
        `Thẩm định Mặt Trước CCCD thất bại: ${frontAnalysis.fraudWarnings.join('; ')}`,
      );
    }

    // 4. Quét OCR và kiểm tra tính nguyên bản ảnh Mặt Sau
    const backAnalysis = await this.scanAndAnalyzeCccd(data.back_image_url, 'BACK');
    if (!backAnalysis.isAuthentic) {
      throw new BadRequestException(
        `Thẩm định Mặt Sau CCCD thất bại: ${backAnalysis.fraudWarnings.join('; ')}`,
      );
    }

    // 5. So khớp số CCCD: Nếu trích xuất được số CCCD trên ảnh mặt trước thì bắt buộc phải trùng khớp
    const extractedCccd = frontAnalysis.extractedData?.cccd_number;
    if (extractedCccd) {
      if (extractedCccd !== data.cccd_number.trim()) {
        throw new BadRequestException(
          `Cảnh báo sai lệch: Số CCCD nhận diện trên ảnh (${extractedCccd}) không trùng khớp với số CCCD bạn khai báo (${data.cccd_number})!`,
        );
      }
    }

    // 6. So khớp họ tên: Nếu nhận diện được họ tên trên ảnh thì phải tương đồng
    const extractedName = frontAnalysis.extractedData?.full_name;
    if (extractedName) {
      const normalizedInputName = this.normalizeString(data.full_name);
      const normalizedExtractedName = this.normalizeString(extractedName);
      const isIncluded =
        normalizedExtractedName.includes(normalizedInputName) ||
        normalizedInputName.includes(normalizedExtractedName);
      if (!isIncluded) {
        throw new BadRequestException(
          `Cảnh báo sai lệch: Họ tên nhận diện trên ảnh (${extractedName}) không trùng khớp với tên khai báo (${data.full_name})!`,
        );
      }
    }

    // 7. Hợp nhất toàn bộ 10 trường dữ liệu
    const fullExtractedData: ExtractedCccdData = {
      ...frontAnalysis.extractedData,
      personal_identification: backAnalysis.extractedData?.personal_identification,
      issue_date: backAnalysis.extractedData?.issue_date,
      mrz_code: backAnalysis.extractedData?.mrz_code,
    };

    return {
      passed: true,
      frontAnalysis,
      backAnalysis,
      matchedCccd: true,
      matchedName: true,
      extractedData: fullExtractedData,
    };
  }
}
