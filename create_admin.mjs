/**
 * Script tạo tài khoản ADMIN trực tiếp vào DB
 * Chạy: node create_admin.mjs
 */
import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '.env') });

const EMAIL = 'nhan54v@gmail.com';
const PASSWORD = 'Nhan1234@';
const FULL_NAME = 'Admin Nhân';
const ROLE_NAME = 'ADMIN';

async function main() {
  const sslOptions = process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false;

  const conn = await createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: sslOptions,
  });

  console.log('✅ Kết nối DB thành công');

  // Kiểm tra email đã tồn tại chưa
  const [existing] = await conn.execute(
    'SELECT id FROM users WHERE email = ?',
    [EMAIL]
  );
  if (existing.length > 0) {
    console.log(`⚠️  Email ${EMAIL} đã tồn tại trong DB (id=${existing[0].id})`);
    await conn.end();
    return;
  }

  // Hash mật khẩu
  const password_hash = await bcrypt.hash(PASSWORD, 12);
  console.log('🔐 Đã hash mật khẩu');

  // Insert user
  const [userResult] = await conn.execute(
    `INSERT INTO users (email, password_hash, full_name, phone_number, avatar_url, status, failed_login_count, locked_until, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, 'ACTIVE', 0, NULL, NOW(), NOW())`,
    [EMAIL, password_hash, FULL_NAME]
  );
  const userId = userResult.insertId;
  console.log(`👤 Đã tạo user id=${userId}`);

  // Lấy role ADMIN
  const [roles] = await conn.execute(
    'SELECT id FROM roles WHERE name = ?',
    [ROLE_NAME]
  );
  if (roles.length === 0) {
    console.error(`❌ Không tìm thấy role ${ROLE_NAME} trong bảng roles!`);
    await conn.end();
    return;
  }
  const roleId = roles[0].id;

  // Gán role ADMIN
  await conn.execute(
    'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
    [userId, roleId]
  );
  console.log(`🎖️  Đã gán role ${ROLE_NAME} (role_id=${roleId}) cho user`);

  await conn.end();
  console.log('\n🎉 Tạo tài khoản admin thành công!');
  console.log(`   Email    : ${EMAIL}`);
  console.log(`   Password : ${PASSWORD}`);
  console.log(`   Role     : ${ROLE_NAME}`);
}

main().catch((err) => {
  console.error('❌ Lỗi:', err.message);
  process.exit(1);
});
