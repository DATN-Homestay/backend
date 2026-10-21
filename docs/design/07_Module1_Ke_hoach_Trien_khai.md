# MODULE 1 – KẾ HOẠCH TRIỂN KHAI CHI TIẾT (CUSTOMER & GIAO DỊCH)
**Người phụ trách**: Thành viên 1 | **Phiên bản**: 1.0 | **Ngày lập**: 17/10/2026
**Căn cứ**: `Homestay_All_in_One_Business_Requirements_v2.1.xlsx`, `02_Thiet_ke_CSDL_Chi_tiet.md`, `03_Thiet_ke_Luong_Sequence.md`, `04_Thiet_ke_API_Specification.md`, `06_Bao_mat_Ha_tang.md`, và code hiện có trên nhánh `dev`.

Tài liệu này chia Module 1 thành **9 giai đoạn**, mỗi giai đoạn là một nhánh/PR riêng tách từ `dev`. Với mỗi giai đoạn có: việc cần làm, file tác động, API, quy tắc nghiệp vụ, kiểm thử, và điều kiện hoàn thành (Definition of Done – DoD).

---

## 0. PHẠM VI MODULE 1

| Phân hệ | Thuộc Module 1 | Ghi chú |
| :--- | :--- | :--- |
| Auth & phiên đăng nhập | ✅ | Dùng chung cho cả 3 module (guard, decorator) |
| Hồ sơ người dùng | ✅ | `/users/me`, đổi mật khẩu, quản lý phiên |
| Đặt phòng & giữ chỗ chống Overbooking | ✅ | `REQ-011`, `REQ-012`, `BR-007`, `BR-009` |
| Thanh toán VNPay (tạo URL, IPN, Return) | ✅ | `REQ-013`, `REQ-014`, `BR-010`, `BR-011` |
| Hủy phòng & hoàn tiền Escrow | ✅ | `FLOW-11`, `BR-021` |
| Mã giảm giá (áp dụng khi đặt) | ✅ | Bảng `coupons` |
| Đánh giá sau lưu trú (khách viết) | ✅ | `BR-018` |
| Check-in / Check-out | ❌ Module 2 (Host) | Module 2 gọi service của Module 1 để đổi trạng thái đơn |
| Giải ngân Payout, Concierge, ABSA, Fraud | ❌ Module 3 | Module 1 phát sự kiện cho Module 3 |

**Nguyên tắc sở hữu dữ liệu**: chỉ Module 1 được **ghi** vào `users` (phần tài khoản), `user_sessions`, `bookings`, `payment_transactions`, `escrow_holds`, `refund_transactions`, `reviews` (phần khách viết). Module khác muốn đổi trạng thái đơn phải gọi service export từ `BookingsModule`.

---

## 1. HIỆN TRẠNG NHÁNH `dev` (17/10/2026)

| Hạng mục | Trạng thái | Việc cần làm |
| :--- | :--- | :--- |
| `npm install` | ❌ Lỗi ERESOLVE: `@nestjs/typeorm@10` không hỗ trợ NestJS 12 | Nâng lên `@nestjs/typeorm@^12.0.2` (GĐ0) |
| `npm run build` (`nest build`) | ❌ Lỗi `ERR_REQUIRE_CYCLE_MODULE` của Nest CLI trên Node 22.14 (lỗi công cụ, không phải code) | Tạm kiểm tra bằng `npx tsc -p tsconfig.build.json`; thử nâng Node lên bản 22 LTS mới nhất |
| Entity `users`, `roles`, `user_roles` | ✅ Có | Thêm cột chống brute-force (GĐ1) |
| `AuthModule` | ❌ Rỗng | GĐ1 |
| `JwtAuthGuard` | ⚠️ Chỉ kiểm tra có header `Bearer`, **không xác minh JWT** | Viết lại (GĐ1) |
| `RolesGuard`, `@CurrentUser()` | ✅ Có | Bổ sung decorator `@Roles()` (GĐ1) |
| Entity `bookings`, `payment_transactions`, `escrow_holds`, `refund_transactions` | ⚠️ Có nhưng thiếu cột (xem Mục 3) | GĐ3–GĐ5 |
| `ValidationPipe`, global prefix `/api/v1`, khung response | ❌ Chưa có | GĐ0 |
| `.env.example` | 🔴 Chứa mật khẩu DB Aiven và Cloudinary secret thật | Đổi mật khẩu trên Aiven/Cloudinary, thay bằng giá trị giả |
| `DB_SYNCHRONIZE=true` trên DB cloud dùng chung | 🔴 Rủi ro mất dữ liệu khi sửa entity | Chuyển sang migration trước khi có dữ liệu thật (GĐ8) |

---

## 2. QUYẾT ĐỊNH KỸ THUẬT ÁP DỤNG CHO MODULE 1

| Mã | Quyết định | Lý do |
| :--- | :--- | :--- |
| KT-01 | API dùng **snake_case** (`full_name`, `access_token`…) | Khớp `04_Thiet_ke_API_Specification.md` |
| KT-02 | Response thành công: `{ statusCode, message, data }`. Lỗi giữ format mặc định của NestJS: `{ statusCode, error, message }` | Khớp tài liệu 04 |
| KT-03 | Access token **15 phút**, refresh token **7 ngày**, xoay vòng mỗi lần refresh, lưu **SHA-256** của refresh token trong bảng mới `user_sessions` | Tài liệu 04 ghi `expires_in: 3600` nhưng token sống ngắn an toàn hơn khi đã có refresh |
| KT-04 | JWT payload: `{ sub, email, roles: string[], sid }`. Guard gắn `request.user = { id, email, roles, session_id }` | `RolesGuard` hiện có đọc `user.roles` dạng mảng tên |
| KT-05 | Đăng ký chỉ nhận `role` = `CUSTOMER` hoặc `HOST`. Host được gán cả `CUSTOMER` + `HOST` (Host vẫn đặt được nhà người khác) | Chặn tự tạo ADMIN |
| KT-06 | Mật khẩu băm **bcryptjs**, cost 10 | Thuần JS, không lỗi build native trên Windows |
| KT-07 | Mỗi `rooms` là **1 đơn vị phòng**. Giữ chỗ bằng `price_calendars.is_available = 0` + `locked_until = now + 15'` trong transaction ngắn với `SELECT ... FOR UPDATE` | Khớp mô hình `rooms`/`price_calendars` và luồng 2 của tài liệu 03 |
| KT-08 | Chỉ hỗ trợ **thanh toán toàn bộ (FULL)** qua VNPay. Không làm trả cọc / tiền mặt | Mô hình Escrow của BR v2.1: sàn giữ toàn bộ tiền |
| KT-09 | Cột `decimal` được TypeORM trả về dạng **string**. Mọi phép tính tiền dùng số nguyên VND (`Math.round`) qua helper `toVnd()`, không cộng chuỗi | Tránh lỗi `'900000' + '1100000'` |
| KT-10 | Ghi trạng thái bằng câu lệnh có điều kiện `UPDATE ... WHERE id = ? AND status = ?` và kiểm tra `affected = 1` | Chống race condition khi IPN và job chạy cùng lúc |
| KT-11 | Chính sách hủy dùng enum hiện có: `FLEXIBLE`, `MODERATE`, `STRICT`, `NON_REFUNDABLE` | Khớp entity `homestays` |

---

## 3. THAY ĐỔI CSDL DO MODULE 1 ĐỀ XUẤT

### 3.1. Bảng mới `user_sessions` (GĐ1)
| Cột | Kiểu | Ghi chú |
| :--- | :--- | :--- |
| `id` | BIGINT UNSIGNED PK | Đưa vào claim `sid` |
| `user_id` | BIGINT UNSIGNED FK → `users.id` | INDEX |
| `refresh_token_hash` | CHAR(64) UNIQUE | SHA-256 của refresh token hiện tại |
| `previous_token_hash` | CHAR(64) NULL, INDEX | Phát hiện dùng lại token cũ |
| `user_agent` | VARCHAR(255) NULL | Lấy từ header, không nhận từ body |
| `ip_address` | VARCHAR(45) NULL | Lấy từ request |
| `expires_at` | TIMESTAMP | Gia hạn mỗi lần refresh |
| `last_used_at` | TIMESTAMP | |
| `revoked_at` | TIMESTAMP NULL | |
| `revoke_reason` | ENUM(`LOGOUT`,`REMOTE`,`PASSWORD_CHANGED`,`REUSE_DETECTED`) NULL | |
| `created_at` | TIMESTAMP | |

### 3.2. Cột thêm vào `users` (GĐ1)
| Cột | Kiểu | Mặc định | Ghi chú |
| :--- | :--- | :--- | :--- |
| `failed_login_count` | INT UNSIGNED | 0 | Reset khi đăng nhập đúng |
| `locked_until` | TIMESTAMP NULL | NULL | Khóa 15 phút sau 5 lần sai |

### 3.3. Cột thêm vào `bookings` (GĐ3–GĐ5)
| Cột | Kiểu | Ghi chú |
| :--- | :--- | :--- |
| `homestay_id` | BIGINT UNSIGNED FK | Có trong tài liệu 02 nhưng entity chưa có |
| `is_dropship` | TINYINT(1) | `homestays.is_claimed = 0` lúc đặt |
| `cancellation_policy` | ENUM (snapshot) | Chụp lại lúc đặt |
| `commission_rate` / `commission_amount` / `net_host_payout` | DECIMAL | Có trong tài liệu 02 (7.5%) nhưng entity chưa có |
| `coupon_id` | BIGINT UNSIGNED NULL | |
| `expires_at` | TIMESTAMP NULL | Hạn giữ chỗ 15 phút |
| `paid_at`, `checked_in_at`, `checked_out_at`, `cancelled_at` | TIMESTAMP NULL | |
| `cancelled_by` | ENUM(`CUSTOMER`,`HOST`,`ADMIN`,`SYSTEM`) NULL | |
| `cancel_reason` | VARCHAR(500) NULL | |
| `status` | thêm giá trị **`EXPIRED`** | Đơn quá 15 phút không thanh toán |

### 3.4. Cột thêm vào `payment_transactions` (GĐ4)
| Cột | Kiểu | Ghi chú |
| :--- | :--- | :--- |
| `vnp_txn_ref` | VARCHAR(40) **UNIQUE** | Mã gửi VNPay, duy nhất cho từng lần thanh toán |
| `vnp_pay_date` | VARCHAR(14) NULL | Bắt buộc khi gọi API hoàn tiền |
| `bank_code` | VARCHAR(20) NULL | |
| `ipn_payload` | JSON NULL | Lưu toàn bộ gói IPN để đối soát |
| `expires_at`, `paid_at` | TIMESTAMP NULL | |

### 3.5. Cột thêm vào `coupons` và `refund_transactions`
- `coupons`: `max_discount`, `usage_limit`, `used_count`, `per_user_limit`, `is_active` (GĐ6).
- `refund_transactions`: `refund_percentage`, `source` (ENUM `CUSTOMER_CANCEL`, `HOST_CANCEL`, `ADMIN_CANCEL`, `LATE_PAYMENT`, `CONCIERGE_FAILED`), `vnp_request_id`, `vnp_transaction_no`, `processed_by`, `processed_at` (GĐ5).

> Mọi cột mới đều **NULL hoặc có DEFAULT** để `synchronize` không làm hỏng dữ liệu đang có trên DB dùng chung.

---

## 4. CÁC GIAI ĐOẠN TRIỂN KHAI

### GĐ0 – Nền tảng chung *(làm cùng PR với GĐ1)*
**Nhánh**: `feature/module1-auth`

- [ ] Sửa `package.json`: `@nestjs/typeorm@^12.0.2` để `npm install` chạy được.
- [ ] Cài: `@nestjs/jwt`, `@nestjs/throttler`, `bcryptjs`, `class-validator`, `class-transformer`.
- [ ] `src/main.ts`: `setGlobalPrefix('api/v1')`, `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`, `TransformResponseInterceptor` toàn cục.
- [ ] `src/common/interceptors/transform-response.interceptor.ts` + decorator `@ResponseMessage()` → bọc kết quả thành `{ statusCode, message, data }`.
- [ ] `ThrottlerModule` trong `AppModule`: mặc định 100 request/phút/IP, đăng ký `ThrottlerGuard` toàn cục.
- [ ] Bổ sung biến môi trường vào `.env.example` (giá trị giả): `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL_SECONDS=900`, `JWT_REFRESH_TTL_DAYS=7`.

**DoD**: `npm install`, `npx tsc --noEmit`, `npm test` đều chạy sạch.

### GĐ1 – Auth & phiên đăng nhập *(đang làm)*
**Nhánh**: `feature/module1-auth`

**File**
```
src/common/decorators/roles.decorator.ts          (mới)  @Roles('ADMIN')
src/common/guards/jwt-auth.guard.ts                (viết lại) xác minh JWT + session
src/modules/auth/auth.module.ts                    (@Global, export JwtModule + AuthTokenService)
src/modules/auth/auth.controller.ts
src/modules/auth/auth.service.ts                   register / login / refresh / logout / me
src/modules/auth/auth-token.service.ts             ký & xác minh token, dùng cho guard
src/modules/auth/role-seed.service.ts              tạo sẵn roles CUSTOMER, HOST, ADMIN khi khởi động
src/modules/auth/entities/user-session.entity.ts
src/modules/auth/dto/{register,login,refresh-token}.dto.ts
src/modules/auth/*.spec.ts
src/modules/users/entities/user.entity.ts          (+ failed_login_count, locked_until)
src/config/database.config.ts                      (+ UserSession)
```

**API**
| Method | Path | Quyền | Rate limit | Mô tả |
| :--- | :--- | :--- | :--- | :--- |
| POST | `/auth/register` | Public | 3/phút/IP | Đăng ký CUSTOMER hoặc HOST |
| POST | `/auth/login` | Public | 5/phút/IP | Cấp access + refresh token, tạo `user_sessions` |
| POST | `/auth/refresh` | Public (refresh token) | 30/phút/IP | Xoay vòng refresh token |
| POST | `/auth/logout` | Bearer | mặc định | Thu hồi phiên hiện tại (lấy `sid` từ token, **không nhận từ body**) |
| GET | `/auth/me` | Bearer | mặc định | Thông tin người dùng hiện tại |

**Ví dụ**
```json
// POST /api/v1/auth/register
{ "email": "customer@example.com", "password": "SecurePass123", "full_name": "Nguyễn Văn A",
  "phone_number": "0912345678", "role": "CUSTOMER" }
// 201
{ "statusCode": 201, "message": "Đăng ký tài khoản thành công",
  "data": { "user_id": "15", "email": "customer@example.com", "full_name": "Nguyễn Văn A", "roles": ["CUSTOMER"] } }

// POST /api/v1/auth/login  →  200
{ "statusCode": 200, "message": "Đăng nhập thành công",
  "data": { "access_token": "eyJ...", "refresh_token": "Yk3...", "token_type": "Bearer", "expires_in": 900,
            "user": { "id": "15", "email": "customer@example.com", "full_name": "Nguyễn Văn A", "roles": ["CUSTOMER"] } } }

// POST /api/v1/auth/refresh  { "refresh_token": "Yk3..." }  →  200
{ "statusCode": 200, "message": "Làm mới token thành công",
  "data": { "access_token": "eyJ...", "refresh_token": "Q9x...", "token_type": "Bearer", "expires_in": 900 } }
```

**Quy tắc**
| Mã | Quy tắc |
| :--- | :--- |
| AU-01 | Email chuyển chữ thường, duy nhất. SĐT (nếu có) dạng `0xxxxxxxxx`, duy nhất. HOST bắt buộc có SĐT (phục vụ OTP ở Module 2). |
| AU-02 | Mật khẩu 8–64 ký tự, có chữ hoa, chữ thường và số. |
| AU-03 | Sai mật khẩu 5 lần liên tiếp → khóa 15 phút (`locked_until`), trả 403. Đăng nhập đúng → reset bộ đếm. |
| AU-04 | Email không tồn tại vẫn chạy `bcrypt.compare` với hash giả để không lộ qua thời gian phản hồi; luôn trả chung thông điệp "Email hoặc mật khẩu không đúng". |
| AU-05 | Tài khoản `status ≠ ACTIVE` không đăng nhập / refresh được. |
| AU-06 | Refresh token: 48 byte ngẫu nhiên (base64url), chỉ lưu SHA-256. Mỗi lần refresh sinh token mới, lưu hash cũ vào `previous_token_hash`. Dùng lại token cũ → thu hồi phiên (`REUSE_DETECTED`), trả 401. |
| AU-07 | `JwtAuthGuard` xác minh chữ ký + hạn token, sau đó kiểm tra `user_sessions` còn hiệu lực. Phiên đã logout thì access token cũ bị chặn ngay, không phải chờ 15 phút. |

**Kiểm thử (Vitest, mock repository như `admin.service.spec.ts`)**
- [ ] Đăng ký thành công: mật khẩu được băm, CUSTOMER nhận role `CUSTOMER`, HOST nhận `CUSTOMER` + `HOST`.
- [ ] Đăng ký trùng email / SĐT → 409. HOST thiếu SĐT → 400.
- [ ] Đăng nhập đúng: trả token, tạo session lưu **hash** (không lưu token thô).
- [ ] Sai mật khẩu tăng bộ đếm; lần thứ 5 đặt `locked_until`; tài khoản đang khóa → 403.
- [ ] Email không tồn tại → 401 cùng thông điệp với sai mật khẩu.
- [ ] Refresh xoay vòng token; dùng lại token cũ → 401 và phiên bị thu hồi; token hết hạn / đã thu hồi → 401.
- [ ] Logout thu hồi đúng phiên của token.
- [ ] Guard: thiếu header → 401; token sai chữ ký → 401; phiên đã thu hồi → 401; hợp lệ → gắn `request.user`.

**DoD**: test pass; Module 2, 3 dùng được `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)` + `@CurrentUser()`; PR vào `dev` được ít nhất 1 thành viên khác review.

**Hợp đồng cho Module 2, 3**
```ts
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Get('payouts/pending')
getPendingPayouts(@CurrentUser('id') adminId: string) { ... }
// request.user = { id: string, email: string, roles: string[], session_id: string }
```

### GĐ2 – Hồ sơ & quản lý phiên
**Nhánh**: `feature/module1-users`
| Method | Path | Mô tả |
| :--- | :--- | :--- |
| GET | `/users/me` | Hồ sơ đầy đủ |
| PATCH | `/users/me` | Sửa `full_name`, `avatar_url` (chỉ URL Cloudinary thuộc thư mục `avatars/{userId}/`) |
| PATCH | `/users/me/password` | Đổi mật khẩu, thu hồi mọi phiên khác (`PASSWORD_CHANGED`) |
| GET | `/users/me/sessions` | Danh sách thiết bị đang đăng nhập |
| DELETE | `/users/me/sessions/:id` | Thu hồi phiên từ xa (chỉ phiên của mình, nếu không → 404) |

Không cho đổi email, SĐT, role qua API này. **Quên mật khẩu** để sau khi nhóm chọn dịch vụ gửi email.

### GĐ3 – Đặt phòng & giữ chỗ chống Overbooking ✅ (backend xong 19/10/2026)
**Nhánh**: `feature/module1-booking`

> Đã làm: `customer-bookings.service.ts`, `booking-expiry.service.ts`; test chống Overbooking trên MySQL thật `test/booking-concurrency.e2e-spec.ts`. Chạy: `IT_DB_PORT=3317 IT_DB_NAME=stayai_it npm run test:e2e`. Chưa làm: mã giảm giá (GĐ6), nối frontend Checkout.

| Method | Path | Mô tả |
| :--- | :--- | :--- |
| POST | `/bookings/quote` | Báo giá theo từng đêm, **không giữ chỗ** |
| POST | `/bookings` | Tạo đơn `PENDING_PAYMENT`, giữ chỗ 15 phút, trả `vnpay_url` (gọi PaymentService của GĐ4) |
| GET | `/users/me/bookings` | Đơn của tôi (lọc `status`, phân trang) |
| GET | `/bookings/:id` | Chi tiết đơn (chủ đơn / Host của nhà / ADMIN; người khác → 404) |

**Quy tắc**
| Mã | Quy tắc |
| :--- | :--- |
| BK-01 | `check_in_date ≥ hôm nay` (giờ VN), `1 ≤ số đêm ≤ 30`. Nhà `is_claimed = 0`: chỉ đặt trong các ngày đã có dữ liệu `price_calendars`. |
| BK-02 | Zero-Trust: tổng tiền = Σ `price_calendars.price` của các đêm `[check_in, check_out)`. Không nhận bất kỳ trường giá nào từ client. |
| BK-03 | `num_guests ≤ rooms.capacity`. Khách không được đặt homestay mà mình là Host. |
| BK-04 | Hoa hồng: `commission_rate = 0.075`, `commission_amount = round(total * 0.075)`, `net_host_payout = total − commission`. |
| BK-05 | Nhà `is_claimed = 0` → `is_dropship = 1` (đơn vào hàng đợi Concierge của Module 3 sau khi thanh toán). |

**Thuật toán giữ chỗ (một transaction ngắn, `READ COMMITTED`)**
```sql
SELECT id, date, price, is_available, locked_until
  FROM price_calendars
 WHERE room_id = :roomId AND date >= :checkIn AND date < :checkOut
 ORDER BY date
 FOR UPDATE;
-- Kiểm tra: đủ số dòng = số đêm, mọi dòng is_available = 1. Không đạt → ROLLBACK, 409.
UPDATE price_calendars SET is_available = 0, locked_until = NOW() + INTERVAL 15 MINUTE
 WHERE room_id = :roomId AND date >= :checkIn AND date < :checkOut;
INSERT INTO bookings (..., status = 'PENDING_PAYMENT', expires_at = NOW() + INTERVAL 15 MINUTE);
COMMIT;
```
**Job `expire-holds` (mỗi 1 phút, `@nestjs/schedule`)**: đơn `PENDING_PAYMENT` có `expires_at < NOW()` → `EXPIRED`; mở lại các ngày (`is_available = 1, locked_until = NULL`). Mỗi đơn xử lý trong 1 transaction, dùng `UPDATE ... WHERE status = 'PENDING_PAYMENT'`.

**Kiểm thử bắt buộc**: 20 request đồng thời vào phòng còn 1 đêm trống → đúng 1 đơn được tạo, 19 request nhận 409 (`AT-07`). Test này chạy trên MySQL thật (DB local/Docker), không dùng mock.

### GĐ4 – Thanh toán VNPay ✅ (backend xong 19/10/2026, chưa thử với VNPay Sandbox thật)
**Nhánh**: `feature/module1-booking` (làm chung nhánh với GĐ3)

> Đã làm: `payments/customer-payments.service.ts`, `vnpay.helper.ts`; endpoint thực tế là `POST /bookings/:id/payment-url` (khách gọi sau khi tạo đơn). Cần điền `VNP_TMN_CODE`, `VNP_HASH_SECRET` và đăng ký IPN URL công khai (xem `.env.example`).

| Method | Path | Mô tả |
| :--- | :--- | :--- |
| (nội bộ) | `PaymentService.createPaymentUrl(booking, ip)` | Gọi từ `POST /bookings` |
| POST | `/bookings/:id/payment-url` | Tạo lại URL nếu khách đóng trang (khi đơn còn hạn) |
| GET | `/vnpay/ipn` | Webhook server-to-server, **nơi duy nhất đổi trạng thái tiền** |
| GET | `/vnpay/return` | Chỉ kiểm tra chữ ký và đọc trạng thái để hiển thị; **không ghi DB** |

**Tạo URL**: `vnp_Version=2.1.0`, `vnp_Command=pay`, `vnp_TmnCode`, `vnp_Amount = total × 100`, `vnp_CurrCode=VND`, `vnp_TxnRef` (= `vnp_txn_ref` của `payment_transactions`, duy nhất), `vnp_OrderInfo`, `vnp_OrderType=other`, `vnp_Locale=vn`, `vnp_ReturnUrl`, `vnp_IpAddr`, `vnp_CreateDate`, `vnp_ExpireDate` (yyyyMMddHHmmss, GMT+7). Sắp xếp key tăng dần → URL-encode → ký **HMAC-SHA512** bằng `VNP_HASH_SECRET`.

**IPN – thứ tự kiểm tra**
| Bước | Điều kiện | Trả về |
| :---: | :--- | :--- |
| 1 | Sai chữ ký | `{"RspCode":"97","Message":"Invalid Checksum"}` |
| 2 | Không tìm thấy `vnp_TxnRef` | `01` Order not found |
| 3 | `vnp_Amount ≠ amount × 100` | `04` Invalid amount |
| 4 | Giao dịch đã xử lý (không còn `PENDING`) | `02` Order already confirmed (lũy đẳng `BR-011`) |
| 5 | `vnp_ResponseCode = 00` và `vnp_TransactionStatus = 00` | Trong 1 transaction: payment `SUCCESS`, booking `PAID_ESCROW`, `price_calendars.locked_until = NULL` (chốt kín), tạo `escrow_holds` (`release_due_at` = check-in + 24h, Module 3 cập nhật khi check-in). Trả `00` |
| 6 | Mã khác 00 | payment `FAILED`, booking giữ `PENDING_PAYMENT` để khách thử lại trong hạn. Trả `00` |
| 7 | IPN thành công nhưng booking đã `EXPIRED` | Nếu phòng còn trống → giữ lại và xác nhận; nếu đã bị đặt → booking `CANCELLED` (`SYSTEM`), tạo hoàn tiền 100% (`LATE_PAYMENT`). Trả `00` |
| – | Lỗi không mong muốn | `99` (VNPay sẽ gọi lại) |

IPN **không** gắn `JwtAuthGuard` và **bỏ qua** `ThrottlerGuard` (`@SkipThrottle()`).

**Kiểm thử**: sửa `vnp_Amount` → `97`; IPN sai số tiền → `04`; gửi 3 IPN trùng → chỉ lần đầu `00`, đơn chỉ chuyển trạng thái 1 lần (`AT-09`); Return URL với `ResponseCode=00` nhưng chưa có IPN → DB không đổi.

### GĐ5 – Hủy phòng & hoàn tiền Escrow
**Nhánh**: `feature/module1-refund`

| Method | Path | Mô tả |
| :--- | :--- | :--- |
| GET | `/bookings/:id/cancellation-quote` | Xem trước số tiền được hoàn |
| POST | `/bookings/:id/cancel` | Khách hủy, body `{ cancellation_reason }` |

**Công thức** (t = thời điểm nhận phòng 14:00 ngày `check_in_date` − thời điểm hủy):
| Chính sách | Hoàn |
| :--- | :--- |
| `FLEXIBLE` | t ≥ 24h → 100%; t < 24h → hoàn toàn bộ trừ tiền đêm đầu |
| `MODERATE` | t ≥ 5 ngày → 100%; t < 5 ngày → 50% |
| `STRICT` | t ≥ 14 ngày → 100%; 7 ≤ t < 14 ngày → 50%; t < 7 ngày → 0% |
| `NON_REFUNDABLE` | 0% |

- Đơn `PENDING_PAYMENT` hủy: chỉ mở lại lịch, không hoàn tiền.
- Đơn `PAID_ESCROW` hủy: mở lại lịch, tạo `refund_transactions` (`PENDING`), job gọi **VNPay Refund API** (`vnp_Command=refund`, `vnp_TransactionType` = `02` toàn phần / `03` một phần), thành công → `PROCESSED`.
- Đơn `CHECKED_IN` trở đi: không cho hủy (chuyển sang khiếu nại).
- **Host / Admin hủy** (service cho Module 2, 3): hoàn 100%, Host bị phạt 20% × `total_amount` (`penalty_amount`) để Module 3 trừ Payout.

### GĐ6 – Mã giảm giá
**Nhánh**: `feature/module1-coupons`
- `POST /coupons/validate`: xem trước mức giảm (server tự tính tiền phòng, không nhận `order_amount` từ client).
- Áp dụng trong `POST /bookings`: khóa dòng coupon (`FOR UPDATE`), kiểm tra hạn, lượt dùng, đơn tối thiểu; tăng `used_count`; trả lại lượt khi đơn `EXPIRED`.
- `sponsor_by = PLATFORM`: hoa hồng tính trên tiền phòng trước giảm. `sponsor_by = HOST`: tính trên tiền sau giảm.
- Không áp dụng mã cho đơn Dropship.

### GĐ7 – Đánh giá sau lưu trú
**Nhánh**: `feature/module1-reviews`
- `POST /bookings/:id/reviews` (multipart, 1–3 ảnh, upload Cloudinary qua service sẵn có): chỉ chủ đơn, đơn `COMPLETED`, trong 30 ngày sau check-out, mỗi đơn 1 lần (`UNIQUE booking_id` đã có).
- `GET /homestays/:id/reviews`: chỉ `APPROVED`, kèm điểm trung bình các khía cạnh.
- Sau khi tạo: phát sự kiện `review.created` để Module 3 chạy Isolation Forest / ABSA bất đồng bộ.

### GĐ8 – Tích hợp & chuẩn bị demo
**Nhánh**: `feature/module1-hardening`
- Chuyển `DB_SYNCHRONIZE=false`, sinh migration cho toàn bộ thay đổi của Module 1.
- E2E (supertest) cho luồng: đăng ký → đăng nhập → đặt phòng → IPN giả lập → hủy → hoàn tiền.
- Script demo `AT-07` (2 trình duyệt cùng đặt), `AT-08` (sửa số tiền), `AT-09` (IPN trùng).
- Job `reconcile-pending-payments` (mỗi 10 phút gọi VNPay `querydr` cho giao dịch PENDING quá hạn, phòng khi IPN bị mất).

---

## 5. SERVICE & SỰ KIỆN MODULE 1 CUNG CẤP

| Service / sự kiện | Bên dùng | Mô tả |
| :--- | :--- | :--- |
| `JwtAuthGuard`, `RolesGuard`, `@Roles()`, `@CurrentUser()` | M2, M3 | GĐ1 |
| `BookingsService.checkIn(bookingId, hostId)` | M2 | `PAID_ESCROW → CHECKED_IN` |
| `BookingsService.checkOut(bookingId, hostId)` | M2 | `CHECKED_IN → COMPLETED` |
| `BookingsService.cancelByHost(bookingId, hostId, reason)` | M2 | GĐ5 |
| `BookingsService.cancelByAdmin(bookingId, adminId, reason)` | M3 | GĐ5 |
| Sự kiện `booking.paid` (kèm `is_dropship`) | M3 | Đưa đơn Dropship vào hàng đợi Concierge |
| Sự kiện `booking.completed` | M3 | Lập bảng kê hoa hồng 7.5% |
| Sự kiện `booking.host_cancel_penalty` | M3 | Trừ 20% vào Payout kỳ sau |
| Sự kiện `review.created` | M3 | Isolation Forest, ABSA |

---

## 6. LỘ TRÌNH ĐỀ XUẤT

| Tuần | Giai đoạn | Kết quả demo được |
| :---: | :--- | :--- |
| 1 | GĐ0, GĐ1, GĐ2 | Đăng ký, đăng nhập, refresh, logout; Module 2, 3 gắn được guard |
| 2 | GĐ3 | Đặt phòng giữ chỗ 15 phút, test đồng thời 20 request |
| 3 | GĐ4 | Thanh toán VNPay Sandbox end-to-end, IPN lũy đẳng |
| 4 | GĐ5, GĐ6 | Hủy & hoàn tiền theo 4 chính sách, mã giảm giá |
| 5 | GĐ7, GĐ8 | Đánh giá, migration, E2E, kịch bản demo trước hội đồng |

**Việc cần làm sớm, song song**: đăng ký tài khoản VNPay Sandbox để có `vnp_TmnCode` và `vnp_HashSecret`.

---

## 7. VIỆC CẦN NHÓM CHỐT

1. Đồng ý các quyết định KT-01 → KT-11 (đặc biệt **KT-08: chỉ thanh toán FULL**).
2. Thống nhất bổ sung cột cho `bookings`, `payment_transactions` (Mục 3) — Module 2 và 3 cũng đọc các bảng này.
3. Đổi mật khẩu DB Aiven và Cloudinary secret, xóa giá trị thật khỏi `.env.example`.
4. Thời điểm chuyển `DB_SYNCHRONIZE=false` và dùng migration.
