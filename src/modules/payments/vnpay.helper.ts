import * as crypto from 'crypto';

/** Việt Nam UTC+7 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export type VnpParams = Record<string, string | number>;

/** yyyyMMddHHmmss theo giờ Việt Nam (GMT+7), định dạng ngày giờ của VNPay */
export function formatVnpDate(date: Date): string {
  return new Date(date.getTime() + VN_OFFSET_MS)
    .toISOString()
    .slice(0, 19)
    .replace(/[-T:]/g, '');
}

/**
 * Chuỗi dữ liệu để ký theo đặc tả VNPay 2.1.0: sắp xếp key tăng dần, mã hóa value
 * bằng encodeURIComponent (khoảng trắng thành '+'), nối key=value bằng '&'.
 */
export function buildSignData(params: VnpParams): string {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map((key) => `${key}=${encodeURIComponent(String(params[key])).replace(/%20/g, '+')}`)
    .join('&');
}

/** HMAC-SHA512 (BR-010) */
export function signParams(params: VnpParams, secret: string): string {
  return crypto
    .createHmac('sha512', secret)
    .update(Buffer.from(buildSignData(params), 'utf-8'))
    .digest('hex');
}

/** URL thanh toán đã ký; vnp_SecureHash nối cuối, không tham gia chuỗi ký */
export function buildPaymentUrl(baseUrl: string, params: VnpParams, secret: string): string {
  const signature = signParams(params, secret);
  return `${baseUrl}?${buildSignData(params)}&vnp_SecureHash=${signature}`;
}

/**
 * Kiểm tra chữ ký của Return URL / IPN. Loại vnp_SecureHash và vnp_SecureHashType
 * khỏi chuỗi ký, so sánh theo thời gian hằng số để chống tấn công timing.
 */
export function verifySignature(query: Record<string, unknown>, secret: string): boolean {
  const received = query['vnp_SecureHash'];
  if (typeof received !== 'string' || !/^[0-9a-fA-F]{128}$/.test(received)) {
    return false;
  }

  const params: VnpParams = {};
  for (const [key, value] of Object.entries(query)) {
    if (key === 'vnp_SecureHash' || key === 'vnp_SecureHashType') continue;
    if (typeof value === 'string' || typeof value === 'number') params[key] = value;
  }

  const expected = Buffer.from(signParams(params, secret), 'hex');
  const actual = Buffer.from(received, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Mã gửi VNPay, duy nhất cho từng lần thanh toán (một đơn có thể thử thanh toán nhiều lần) */
export function generateTxnRef(bookingCode: string): string {
  return `${bookingCode}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/** Địa chỉ IP cho vnp_IpAddr: bỏ tiền tố IPv4-mapped, ::1 đổi thành 127.0.0.1 */
export function normalizeIp(ip: string | undefined | null): string {
  if (!ip || ip === '::1') return '127.0.0.1';
  return ip.replace(/^::ffff:/, '');
}

/** Phản hồi IPN theo đúng định dạng VNPay yêu cầu */
export const IPN_RESPONSE = {
  SUCCESS: { RspCode: '00', Message: 'Confirm Success' },
  ORDER_NOT_FOUND: { RspCode: '01', Message: 'Order not found' },
  ALREADY_CONFIRMED: { RspCode: '02', Message: 'Order already confirmed' },
  INVALID_AMOUNT: { RspCode: '04', Message: 'Invalid amount' },
  INVALID_CHECKSUM: { RspCode: '97', Message: 'Invalid Checksum' },
  UNKNOWN_ERROR: { RspCode: '99', Message: 'Unknown error' },
} as const;
