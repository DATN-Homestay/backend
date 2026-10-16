# THIẾT KẾ BẢO MẬT & HẠ TẦNG TRIỂN KHAI (SECURITY & INFRASTRUCTURE)
**Tài liệu tham chiếu**: `Homestay_All_in_One_Business_Requirements_v2.1.xlsx` (Sheet `04_Quy_tac`, `07_Can_chot`)

---

## 1. THIẾT KẾ BẢO MẬT DỮ LIỆU ĐỊNH DANH (PII SECURITY)

### 1.1. Mã hóa Đối xứng AES-256-CBC cho Số CCCD & STK Ngân hàng (`BR-012`)
Toàn bộ dữ liệu định danh cá nhân nhạy cảm của Chủ nhà trước khi ghi xuống MySQL đều được mã hóa bằng thuật toán chuẩn quân đội **AES-256-CBC**:
* **Khóa bí mật (`AES_SECRET_KEY`)**: Chuỗi 32 bytes (256 bits) được lưu trữ an toàn trong biến môi trường `.env`, tuyệt đối không commit lên Git.
* **Vector Khởi tạo (IV - Initialization Vector)**: Mỗi bản ghi sinh ngẫu nhiên 16 bytes IV (`crypto.randomBytes(16)`), ghép với chuỗi mã hóa theo định dạng: `IV_HEX:CIPHERTEXT_HEX`.
* **Cơ chế Tra cứu Chống trùng lặp (Blind Indexing)**:
  - Để kiểm tra số CCCD đã tồn tại trong hệ thống hay chưa mà không cần giải mã toàn bộ bảng `host_verification_documents`, hệ thống tạo một cột băm một chiều:
    $$\text{cccd\_hash} = \text{SHA-256}(\text{cccd\_number})$$
  - Khi tra cứu: `SELECT * FROM host_verification_documents WHERE cccd_hash = ?`.

```typescript
// Code chuẩn AES-256-CBC trong NestJS Service
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const SECRET_KEY = Buffer.from(process.env.AES_SECRET_KEY, 'hex'); // 32 bytes

export function encryptAES(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

export function decryptAES(encryptedText: string): string {
  const [ivHex, cipherHex] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
  let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### 1.2. Bảo mật Ảnh CCCD qua Cloudinary Private Signed URLs
* **Cơ chế**: Ảnh CCCD 2 mặt của Host không được phép lưu ở dạng link Public trên Internet.
* **Cấu hình Upload**: `type: "authenticated"`, `access_mode: "authenticated"`.
* **Cơ chế Truy cập**: Chỉ khi Admin có vai trò hợp lệ đăng nhập vào hệ thống kiểm duyệt eKYC, Backend NestJS mới sinh ra một **URL ký số có thời hạn (Signed Temporary URL)** có hiệu lực trong **5 phút** (`expires_at = NOW() + 300`):
  ```text
  https://res.cloudinary.com/<cloud_name>/image/authenticated/s--SIGNATURE--/v1/cccd_front_038.jpg
  ```
* Hết 5 phút, đường link tự động vô hiệu hóa, ngăn chặn hoàn toàn nguy cơ rò rỉ dữ liệu thẻ CCCD của công dân.

---

## 2. THIẾT KẾ BẢO MẬT DÒNG TIỀN & GIAO DỊCH (FINANCIAL SECURITY)

1. **Nguyên tắc Zero-Trust Client (`BR-009`)**:
   - Backend không chấp nhận tham số `total_amount` từ Frontend truyền xuống khi tạo đơn.
   - Backend tự truy vấn bảng `price_calendars` theo các ngày khách chọn, cộng dồn giá và trừ mã giảm giá (nếu có) trên Server trước khi tạo đơn và sinh URL VNPay.
2. **Xác thực Chữ ký số HMAC-SHA512 (`BR-010`)**:
   - Mọi URL thanh toán gửi sang VNPay đều được tạo mã băm với khóa bí mật `vnp_HashSecret`. Nếu hacker dùng Burp Suite hoặc F12 sửa số tiền từ 2.000.000đ thành 10.000đ, cổng VNPay sẽ từ chối giao dịch với mã lỗi `97 - Invalid Checksum`.
3. **Tính Lũy đẳng trong Webhook IPN (`BR-011`)**:
   - Gói tin IPN từ VNPay có thể bị gửi lại nhiều lần do trễ mạng. Backend dùng transaction kiểm tra trạng thái đơn: nếu đã `PAID` $\rightarrow$ bỏ qua và trả về mã `02 - Order already confirmed`, tuyệt đối không cộng trùng doanh thu cho Host.
4. **Kiểm soát Kép Giải ngân Maker-Checker (`BR-013`, `BR-020`)**:
   - Hệ thống tự động lập bảng kê chia hoa hồng 7.5% (Maker).
   - Admin Kế toán kiểm tra đối chiếu Họ tên trên CCCD khớp 100% với Tên chủ tài khoản Ngân hàng mới thực hiện chuyển khoản và tải biên lai ngân hàng lên để phê duyệt (Checker).

---

## 3. THIẾT KẾ BẢO MẬT API & PHÂN QUYỀN RBAC (`REQ-028`)

1. **Bảo mật Mật khẩu**: Băm bằng Bcrypt với Salt Rounds = 10, chống tấn công Rainbow Table.
2. **Phân quyền bằng NestJS RolesGuard**:
   - `@Roles('CUSTOMER')`: Tìm kiếm, đặt phòng, thanh toán, đánh giá.
   - `@Roles('HOST_VERIFIED')`: Quản lý homestay đã xác thực, xem doanh thu, cài đặt lịch giá.
   - `@Roles('ADMIN')`: Toàn quyền hệ thống, duyệt hồ sơ eKYC 70-99đ, giải ngân Payout, xử lý gian lận.
3. **Giới hạn Tần suất Gọi API (Rate Limiting)**:
   - Cài đặt `@nestjs/throttler`:
     - API Đăng nhập / Đổi mật khẩu: Tối đa 5 lần / phút / IP (chống Brute-force).
     - API Gửi mã OTP: Tối đa 3 lần / phút / SĐT (chống spam SMS).
     - API Thanh toán: Tối đa 10 lần / phút / User.

---

## 4. HẠ TẦNG PHÁT TRIỂN & ĐÓNG GÓI DOCKER COMPOSE

### 4.1. Cơ sở Dữ liệu Online Đám mây (Aiven for MySQL Cloud)
* Thay vì chạy local phụ thuộc máy cá nhân hoặc mạng LAN ảo (Radmin VPN), nhóm sử dụng **Aiven for MySQL Cloud**:
  - Dịch vụ cơ sở dữ liệu MySQL 8.0 được quản trị hoàn toàn trên Đám mây (Fully Managed Cloud Database).
  - Hoạt động 24/7 trực tuyến trên hạ tầng Cloud tiêu chuẩn, tự động sao lưu định kỳ.
  - Kết nối bảo mật bắt buộc qua giao thức **SSL/TLS (Mã hóa đường truyền bằng chứng chỉ `ca.pem`)**.
  - Cả 3 thành viên trong nhóm đồ án cùng kết nối trực tiếp đến Service URI của Aiven để code chung mà không bao giờ bị lệch dữ liệu:
  ```env
  # Cấu hình kết nối Aiven Cloud MySQL trong file .env
  DB_HOST=mysql-xxxx-your-project.aivencloud.com
  DB_PORT=25060                      # Cổng Remote port do Aiven cấp phát
  DB_USERNAME=avnadmin
  DB_PASSWORD=your_aiven_password_secret
  DB_DATABASE=defaultdb              # hoặc homestay_marketplace
  DB_SSL=true
  DB_SSL_CA_PATH=./certs/ca.pem      # Chứng chỉ SSL tải từ Dashboard Aiven
  ```
* **Cấu hình TypeORM trong NestJS kết nối Aiven với SSL**:
  ```typescript
  TypeOrmModule.forRoot({
    type: 'mysql',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: {
      rejectUnauthorized: true,
      ca: fs.readFileSync(process.env.DB_SSL_CA_PATH).toString(),
    },
    autoLoadEntities: true,
    synchronize: false,
  })
  ```

### 4.2. File `docker-compose.yml` Hoàn chỉnh Triển khai Hệ thống

```yaml
version: '3.8'

services:
  # 1. Core Backend NestJS (Kết nối Aiven Cloud MySQL qua SSL)
  backend_nest:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: homestay_backend
    restart: always
    environment:
      PORT: 3000
      DB_HOST: ${DB_HOST}
      DB_PORT: ${DB_PORT}
      DB_USERNAME: ${DB_USERNAME}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_DATABASE: ${DB_DATABASE}
      DB_SSL: "true"
      AI_SERVICE_URL: http://ai_fastapi:8000
      RAPIDAPI_KEY: ${RAPIDAPI_KEY}
      RAPIDAPI_HOST: booking-com15.p.rapidapi.com
      CACHE_TTL_PRICE_HOURS: 6
    ports:
      - "3000:3000"

  # 2. AI Microservice Python FastAPI
  ai_fastapi:
    build:
      context: ./ai-service
      dockerfile: Dockerfile
    container_name: homestay_ai_service
    restart: always
    environment:
      DB_HOST: ${DB_HOST}
      DB_PORT: ${DB_PORT}
      DB_USER: ${DB_USERNAME}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_NAME: ${DB_DATABASE}
      DB_SSL_MODE: "REQUIRED"
    ports:
      - "8000:8000"

  # 3. Frontend Web Application (React / Vite)
  frontend_web:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: homestay_frontend
    restart: always
    ports:
      - "5173:80"
```

