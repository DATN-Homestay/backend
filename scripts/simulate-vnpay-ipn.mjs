#!/usr/bin/env node
/**
 * CÔNG CỤ DEV: giả lập VNPay gọi IPN về backend để thử "thanh toán thành công" mà không cần
 * ngrok. Script tự ký gói IPN bằng VNP_HASH_SECRET của bạn, giống hệt cách VNPay ký.
 *
 * Dùng:
 *   node scripts/simulate-vnpay-ipn.mjs <mã đơn BKxxxx>            # thanh toán thành công
 *   node scripts/simulate-vnpay-ipn.mjs <mã đơn BKxxxx> --fail     # thanh toán thất bại (mã 24)
 *   node scripts/simulate-vnpay-ipn.mjs <mã đơn BKxxxx> --repeat=3 # gửi IPN trùng 3 lần (kiểm tra lũy đẳng)
 *   Tùy chọn: --url=http://localhost:3000
 *
 * Cần: đơn đã bấm "Thanh toán VNPay" (để có giao dịch PENDING). Đọc cấu hình từ .env.local và .env
 * (biến môi trường có sẵn được ưu tiên). Chỉ dùng cho máy dev, từ chối chạy khi NODE_ENV=production.
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';

if (process.env.NODE_ENV === 'production') {
  console.error('Từ chối chạy khi NODE_ENV=production.');
  process.exit(1);
}

// ---------- đọc .env (không phụ thuộc thư viện) ----------
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv('.env.local');
loadEnv('.env');

// ---------- tham số ----------
const args = process.argv.slice(2);
const bookingCode = args.find((a) => !a.startsWith('--'));
const flag = (name) => args.find((a) => a.startsWith(`--${name}`));
const fail = !!flag('fail');
const repeat = Number(flag('repeat')?.split('=')[1] ?? 1);
const baseUrl = flag('url')?.split('=')[1] ?? `http://localhost:${process.env.PORT ?? 3000}`;

if (!bookingCode) {
  console.error('Thiếu mã đơn. Ví dụ: node scripts/simulate-vnpay-ipn.mjs BK20261023AB12CD34');
  process.exit(1);
}
const { VNP_TMN_CODE: tmnCode, VNP_HASH_SECRET: secret } = process.env;
if (!tmnCode || !secret) {
  console.error('Thiếu VNP_TMN_CODE / VNP_HASH_SECRET trong .env.local hoặc .env');
  process.exit(1);
}

// ---------- tìm giao dịch đang chờ của đơn ----------
const db = await mysql.createConnection({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
const [rows] = await db.query(
  `SELECT p.vnp_txn_ref, p.amount, p.status, b.status AS booking_status
     FROM payment_transactions p JOIN bookings b ON b.id = p.booking_id
    WHERE b.booking_code = ? ORDER BY p.id DESC LIMIT 1`,
  [bookingCode],
);
await db.end();

if (rows.length === 0) {
  console.error(`Không có giao dịch nào của đơn ${bookingCode}. Hãy bấm "Thanh toán VNPay" trên giao diện trước.`);
  process.exit(1);
}
const payment = rows[0];
console.log(`Đơn ${bookingCode}: đơn=${payment.booking_status}, giao dịch=${payment.status}, ${Number(payment.amount).toLocaleString('vi-VN')}đ`);

// ---------- ký đúng như VNPay (HMAC-SHA512 trên key sắp xếp, value URL-encode, ' ' -> '+') ----------
const params = {
  vnp_Amount: String(Math.round(Number(payment.amount)) * 100),
  vnp_BankCode: 'NCB',
  vnp_CardType: 'ATM',
  vnp_PayDate: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19).replace(/[-T:]/g, ''),
  vnp_ResponseCode: fail ? '24' : '00',
  vnp_TmnCode: tmnCode,
  vnp_TransactionNo: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
  vnp_TransactionStatus: fail ? '02' : '00',
  vnp_TxnRef: payment.vnp_txn_ref,
};
const signData = Object.keys(params)
  .sort()
  .map((k) => `${k}=${encodeURIComponent(params[k]).replace(/%20/g, '+')}`)
  .join('&');
const hash = createHmac('sha512', secret).update(Buffer.from(signData, 'utf-8')).digest('hex');
const url = `${baseUrl}/api/v1/vnpay/ipn?${signData}&vnp_SecureHash=${hash}`;

// ---------- gọi IPN ----------
for (let i = 1; i <= repeat; i++) {
  const res = await fetch(url);
  console.log(`IPN lần ${i}: HTTP ${res.status} ${await res.text()}`);
}
console.log(fail ? 'Đã giả lập thanh toán THẤT BẠI.' : 'Đã giả lập thanh toán THÀNH CÔNG. Tải lại trang kết quả hoặc Chuyến đi của tôi.');
