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

// =========================================================
// API HOÀN TIỀN (vnp_Command = refund)
// =========================================================

export interface RefundRequestInput {
  /** Duy nhất cho từng yêu cầu, tối đa 32 ký tự; gửi lại cùng giá trị thì VNPay coi là yêu cầu trùng */
  requestId: string;
  tmnCode: string;
  /** 02: hoàn toàn phần, 03: hoàn một phần */
  transactionType: '02' | '03';
  txnRef: string;
  amountVnd: number;
  /** Mã giao dịch phía VNPay (vnp_TransactionNo); có thể để trống */
  transactionNo?: string;
  /** vnp_PayDate của giao dịch gốc, yyyyMMddHHmmss */
  transactionDate: string;
  createBy: string;
  createDate: string;
  ipAddr: string;
  orderInfo: string;
}

/** Chuỗi ký của yêu cầu hoàn tiền: các trường nối bằng '|' theo ĐÚNG thứ tự VNPay quy định */
export function buildRefundSignData(input: RefundRequestInput): string {
  return [
    input.requestId,
    '2.1.0',
    'refund',
    input.tmnCode,
    input.transactionType,
    input.txnRef,
    String(input.amountVnd * 100),
    input.transactionNo ?? '',
    input.transactionDate,
    input.createBy,
    input.createDate,
    input.ipAddr,
    input.orderInfo,
  ].join('|');
}

/** Body JSON gửi lên API hoàn tiền, đã ký HMAC-SHA512 */
export function buildRefundRequest(
  input: RefundRequestInput,
  secret: string,
): Record<string, string> {
  return {
    vnp_RequestId: input.requestId,
    vnp_Version: '2.1.0',
    vnp_Command: 'refund',
    vnp_TmnCode: input.tmnCode,
    vnp_TransactionType: input.transactionType,
    vnp_TxnRef: input.txnRef,
    vnp_Amount: String(input.amountVnd * 100),
    vnp_OrderInfo: input.orderInfo,
    vnp_TransactionNo: input.transactionNo ?? '',
    vnp_TransactionDate: input.transactionDate,
    vnp_CreateBy: input.createBy,
    vnp_CreateDate: input.createDate,
    vnp_IpAddr: input.ipAddr,
    vnp_SecureHash: crypto
      .createHmac('sha512', secret)
      .update(Buffer.from(buildRefundSignData(input), 'utf-8'))
      .digest('hex'),
  };
}

const REFUND_RESPONSE_FIELDS = [
  'vnp_ResponseId',
  'vnp_Command',
  'vnp_ResponseCode',
  'vnp_Message',
  'vnp_TmnCode',
  'vnp_TxnRef',
  'vnp_Amount',
  'vnp_BankCode',
  'vnp_PayDate',
  'vnp_TransactionNo',
  'vnp_TransactionType',
  'vnp_TransactionStatus',
  'vnp_OrderInfo',
] as const;

/** Kiểm tra chữ ký phản hồi của API hoàn tiền (các trường thiếu tính là chuỗi rỗng) */
export function verifyRefundResponse(response: Record<string, unknown>, secret: string): boolean {
  const received = response['vnp_SecureHash'];
  if (typeof received !== 'string' || !/^[0-9a-fA-F]{128}$/.test(received)) return false;

  const data = REFUND_RESPONSE_FIELDS.map((key) => {
    const value = response[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }).join('|');
  const expected = Buffer.from(
    crypto.createHmac('sha512', secret).update(Buffer.from(data, 'utf-8')).digest('hex'),
    'hex',
  );
  const actual = Buffer.from(received, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
