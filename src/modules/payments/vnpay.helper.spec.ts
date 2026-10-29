import * as crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import {
  buildPaymentUrl,
  buildRefundRequest,
  buildRefundSignData,
  verifyRefundResponse,
  buildSignData,
  formatVnpDate,
  generateTxnRef,
  normalizeIp,
  signParams,
  verifySignature,
} from './vnpay.helper.js';

const SECRET = 'TEST_SECRET_KEY_0123456789';

const baseParams = {
  vnp_Version: '2.1.0',
  vnp_Command: 'pay',
  vnp_TmnCode: 'TMN12345',
  vnp_Amount: 180000000,
  vnp_CurrCode: 'VND',
  vnp_TxnRef: 'BK20261019AAAA1111-1A2B3C',
  vnp_OrderInfo: 'Thanh toan don BK20261019AAAA1111',
  vnp_OrderType: 'other',
  vnp_Locale: 'vn',
  vnp_ReturnUrl: 'http://localhost:3000/api/v1/vnpay/return',
  vnp_IpAddr: '127.0.0.1',
  vnp_CreateDate: '20261019150000',
};

/** Parse URL do buildPaymentUrl sinh ra thành query như Express sẽ nhận được */
const queryOf = (url: string) => Object.fromEntries(new URL(url).searchParams.entries());

describe('vnpay.helper', () => {
  describe('buildSignData()', () => {
    it('nên sắp xếp key tăng dần và mã hóa khoảng trắng thành +', () => {
      const data = buildSignData({ vnp_OrderInfo: 'Thanh toan don 1', vnp_Amount: 100, vnp_Command: 'pay' });

      expect(data).toBe('vnp_Amount=100&vnp_Command=pay&vnp_OrderInfo=Thanh+toan+don+1');
    });

    it('nên mã hóa ký tự đặc biệt trong URL', () => {
      const data = buildSignData({ vnp_ReturnUrl: 'http://x.vn/a?b=1&c=2' });

      expect(data).toBe('vnp_ReturnUrl=http%3A%2F%2Fx.vn%2Fa%3Fb%3D1%26c%3D2');
    });

    it('nên bỏ qua giá trị rỗng', () => {
      expect(buildSignData({ a: '', b: 'x' })).toBe('b=x');
    });
  });

  describe('signParams()', () => {
    it('nên khớp HMAC-SHA512 tính độc lập theo đúng đặc tả', () => {
      const signData =
        'vnp_Amount=180000000&vnp_Command=pay&vnp_CreateDate=20261019150000&vnp_CurrCode=VND' +
        '&vnp_IpAddr=127.0.0.1&vnp_Locale=vn&vnp_OrderInfo=Thanh+toan+don+BK20261019AAAA1111' +
        '&vnp_OrderType=other&vnp_ReturnUrl=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fv1%2Fvnpay%2Freturn' +
        '&vnp_TmnCode=TMN12345&vnp_TxnRef=BK20261019AAAA1111-1A2B3C&vnp_Version=2.1.0';
      const expected = crypto.createHmac('sha512', SECRET).update(signData, 'utf-8').digest('hex');

      expect(signParams(baseParams, SECRET)).toBe(expected);
      expect(expected).toHaveLength(128);
    });

    it('nên cho chữ ký khác nhau khi đổi số tiền (chống sửa giá trên URL)', () => {
      expect(signParams({ ...baseParams, vnp_Amount: 1000000 }, SECRET)).not.toBe(
        signParams(baseParams, SECRET),
      );
    });
  });

  describe('verifySignature()', () => {
    it('nên chấp nhận URL do chính mình ký', () => {
      expect(verifySignature(queryOf(buildPaymentUrl('https://vnp.test/pay', baseParams, SECRET)), SECRET)).toBe(true);
    });

    it('AT-08: nên từ chối khi sửa vnp_Amount từ 1.800.000đ xuống 10.000đ', () => {
      const query = queryOf(buildPaymentUrl('https://vnp.test/pay', baseParams, SECRET));
      query.vnp_Amount = '1000000';

      expect(verifySignature(query, SECRET)).toBe(false);
    });

    it('nên từ chối khi sai secret, thiếu chữ ký hoặc chữ ký sai định dạng', () => {
      const query = queryOf(buildPaymentUrl('https://vnp.test/pay', baseParams, SECRET));

      expect(verifySignature(query, 'OTHER_SECRET')).toBe(false);
      expect(verifySignature({ ...query, vnp_SecureHash: undefined }, SECRET)).toBe(false);
      expect(verifySignature({ ...query, vnp_SecureHash: 'abc' }, SECRET)).toBe(false);
    });

    it('nên bỏ qua vnp_SecureHashType khi kiểm tra', () => {
      const query = { ...queryOf(buildPaymentUrl('https://vnp.test/pay', baseParams, SECRET)), vnp_SecureHashType: 'HmacSHA512' };

      expect(verifySignature(query, SECRET)).toBe(true);
    });
  });

  describe('tiện ích', () => {
    it('formatVnpDate: đổi sang giờ Việt Nam GMT+7', () => {
      expect(formatVnpDate(new Date('2026-10-19T08:30:05Z'))).toBe('20261019153005');
      expect(formatVnpDate(new Date('2026-10-19T20:00:00Z'))).toBe('20261020030000');
    });

    it('generateTxnRef: duy nhất cho mỗi lần thanh toán', () => {
      const refs = new Set(Array.from({ length: 200 }, () => generateTxnRef('BK1')));

      expect(refs.size).toBe(200);
      expect([...refs][0]).toMatch(/^BK1-[0-9A-F]{6}$/);
    });

    it('normalizeIp', () => {
      expect(normalizeIp('::1')).toBe('127.0.0.1');
      expect(normalizeIp('::ffff:118.70.12.5')).toBe('118.70.12.5');
      expect(normalizeIp(undefined)).toBe('127.0.0.1');
      expect(normalizeIp('27.72.1.9')).toBe('27.72.1.9');
    });
  });

  describe('API hoàn tiền', () => {
    const refundInput = {
      requestId: 'RF12A1',
      tmnCode: 'TMN12345',
      transactionType: '03' as const,
      txnRef: 'BK20261019AAAA1111-1A2B3C',
      amountVnd: 1500000,
      transactionNo: '14500001',
      transactionDate: '20261019153005',
      createBy: 'StayAI-System',
      createDate: '20261020101500',
      ipAddr: '127.0.0.1',
      orderInfo: 'Hoan tien don 12',
    };

    it('chuỗi ký nối bằng | đúng thứ tự trong tài liệu VNPay, tiền nhân 100', () => {
      expect(buildRefundSignData(refundInput)).toBe(
        'RF12A1|2.1.0|refund|TMN12345|03|BK20261019AAAA1111-1A2B3C|150000000|14500001|20261019153005|StayAI-System|20261020101500|127.0.0.1|Hoan tien don 12',
      );
    });

    it('body request có đủ trường, chữ ký khớp HMAC-SHA512 tính độc lập', () => {
      const body = buildRefundRequest(refundInput, SECRET);
      const expected = crypto
        .createHmac('sha512', SECRET)
        .update(buildRefundSignData(refundInput), 'utf-8')
        .digest('hex');

      expect(body.vnp_SecureHash).toBe(expected);
      expect(body).toMatchObject({
        vnp_Command: 'refund',
        vnp_Version: '2.1.0',
        vnp_TransactionType: '03',
        vnp_Amount: '150000000',
        vnp_TransactionNo: '14500001',
      });
    });

    it('vnp_TransactionNo để trống vẫn nằm đúng vị trí trong chuỗi ký', () => {
      const data = buildRefundSignData({ ...refundInput, transactionNo: undefined });
      expect(data.split('|')[7]).toBe('');
      expect(data.split('|')).toHaveLength(13);
    });

    /** Phản hồi VNPay ký theo thứ tự trường trong tài liệu */
    const signedResponse = (overrides: Record<string, string> = {}) => {
      const response: Record<string, string> = {
        vnp_ResponseId: 'RES1',
        vnp_Command: 'refund',
        vnp_ResponseCode: '00',
        vnp_Message: 'Refund Success',
        vnp_TmnCode: 'TMN12345',
        vnp_TxnRef: 'BK1-AAAAAA',
        vnp_Amount: '150000000',
        vnp_BankCode: 'NCB',
        vnp_PayDate: '20261020101530',
        vnp_TransactionNo: '14500002',
        vnp_TransactionType: '03',
        vnp_TransactionStatus: '05',
        vnp_OrderInfo: 'Hoan tien don 12',
        ...overrides,
      };
      const data = [
        'vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode',
        'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo',
        'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo',
      ].map((k) => response[k] ?? '').join('|');
      return { ...response, vnp_SecureHash: crypto.createHmac('sha512', SECRET).update(data, 'utf-8').digest('hex') };
    };

    it('verifyRefundResponse: chấp nhận phản hồi ký đúng', () => {
      expect(verifyRefundResponse(signedResponse(), SECRET)).toBe(true);
    });

    it('verifyRefundResponse: từ chối khi bị sửa mã/số tiền, sai secret hoặc thiếu chữ ký', () => {
      const ok = signedResponse();
      expect(verifyRefundResponse({ ...ok, vnp_ResponseCode: '00', vnp_Amount: '1' }, SECRET)).toBe(false);
      expect(verifyRefundResponse(ok, 'SECRET_KHAC')).toBe(false);
      expect(verifyRefundResponse({ ...ok, vnp_SecureHash: undefined }, SECRET)).toBe(false);
      // Phản hồi lỗi như mã 99 không có chữ ký
      expect(verifyRefundResponse({ vnp_ResponseCode: '99', vnp_Message: 'Unexpected error' }, SECRET)).toBe(false);
    });
  });
});
