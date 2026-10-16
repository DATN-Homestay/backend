# TÀI LIỆU THIẾT KẾ KIẾN TRÚC TỔNG THỂ HỆ THỐNG
**Dự án**: Sàn Giao dịch Homestay Lai tích hợp AI (Homestay Booking & AI Hybrid Marketplace)  
**Phiên bản**: 2.1 | **Ngày lập**: 16/10/2026 | **Tài liệu tham chiếu**: `Homestay_All_in_One_Business_Requirements_v2.1.xlsx`

---

## 1. MÔ HÌNH KIẾN TRÚC TỔNG THỂ (HIGH-LEVEL ARCHITECTURE)

Hệ thống được thiết kế theo kiến trúc lai **Modular Monolith kết hợp AI Microservice** nhằm đạt được sự cân bằng tối ưu giữa tốc độ phát triển đồ án và tính độc lập của các tác vụ tính toán AI nặng:

```mermaid
graph TB
    subgraph Clients["TẦNG GIAO DIỆN (CLIENT TIER)"]
        FE_Customer["Customer Web (React/Vite)<br/>- Tìm kiếm RAG / Visual Search<br/>- Đặt phòng & VNPay<br/>- Review Radar ABSA"]
        FE_Host["Host Extranet (React/Vite)<br/>- Xác thực 4 lớp (CCCD/OTP/GPS/Live)<br/>- Quản lý phòng & Lịch giá<br/>- Dynamic Pricing & Smart Reply"]
        FE_Admin["Admin Dashboard (React/Vite)<br/>- Concierge Dropshipping<br/>- Duyệt eKYC 70-99đ<br/>- Đối soát hoa hồng 7.5% Maker-Checker"]
    end

    subgraph Gateway["TẦNG TRUY CẬP & ĐIỀU PHỐI (ACCESS CONTROL)"]
        ReverseProxy["Reverse Proxy / Nginx & Port Binding"]
        RBAC_Guard["NestJS Guards (JWT Auth + RolesGuard + Throttler RateLimit)"]
    end

    subgraph CoreBackend["CORE BACKEND (Modular Monolith - NestJS)"]
        Module_Auth["Auth & Security Module<br/>(Bcrypt, AES-256 PII Encryptor)"]
        Module_Property["Property & Rooms Module<br/>(Cloudinary Media Manager)"]
        Module_Verification["Unified Verification Engine<br/>(Trust Score 140đ Calculator)"]
        Module_Booking["Booking & Concurrency Engine<br/>(MySQL Transaction & Row Locking)"]
        Module_Payment["Payment & Escrow Module<br/>(VNPay HMAC-SHA512 & IPN Webhook)"]
        Module_Refund["Refund & Cancellation Engine<br/>(Escrow Refund & Penalty Engine)"]
        Module_Finance["Finance & Settlement Module<br/>(Commission 7.5% & Maker-Checker)"]
        Module_Chat["Realtime Chat & WebSocket Gateway<br/>(Socket.io, JWT WsAuthGuard, Smart Reply Trigger)"]
    end

    subgraph AIService["AI & DATA SERVICE (Python FastAPI)"]
        Worker_RapidAPI["RapidAPI Travel Gateway Worker<br/>- Booking Data API via RapidAPI<br/>- Static Data Intake (1 lần duy nhất)<br/>- Dynamic Market Sync (TTL 6h & Cron 02:00)"]
        CV_Engine["Computer Vision Engine<br/>- OCR CCCD (EasyOCR/PaddleOCR)<br/>- Blur Check (Laplacian)<br/>- CLIP Cosine Match (Live vs Stock)"]
        NLP_Engine["NLP & Semantic Engine<br/>- Invisible RAG Search Bar<br/>- Review ABSA Sentiment Analyzer<br/>- Smart Reply Suggestion"]
        ML_Engine["Machine Learning Engine<br/>- Isolation Forest Anomaly Detection<br/>- XGBoost / Cosine LTR Recommendation<br/>- Dynamic Pricing Heuristic Engine (CompSet 3-5km)"]
    end

    subgraph DataStorage["TẦNG DỮ LIỆU & BỘ NHỚ LƯU TRỮ (PERSISTENCE TIER)"]
        DB_MySQL[("Aiven Cloud MySQL 8.0 (InnoDB)<br/>- Managed Cloud Database (Aiven.io)<br/>- SSL/TLS Encrypted Connection (ca.pem)<br/>- Row-level Lock: SELECT ... FOR UPDATE<br/>- Mã hóa AES-256 CCCD/STK<br/>- Price Calendar & CompSet Cache")]
        Cloudinary_Storage[("Cloudinary Cloud Media<br/>- Public CDN: Ảnh Homestay / Phòng<br/>- Authenticated Storage: Ảnh CCCD 2 mặt")]
        Vector_Cache[("In-Memory / Vector Storage<br/>- CLIP Embeddings Cache<br/>- Semantic Search Embeddings")]
    end

    subgraph ExternalServices["DỊCH VỤ NGOẠI VI (THIRD-PARTY INTEGRATIONS)"]
        VNPay_Gateway["VNPay Payment Gateway Sandbox<br/>(HMAC-SHA512 & IPN)"]
        Google_Maps_API["Google Maps Places & Geocoding"]
        RapidAPI_Gateway["RapidAPI Third-Party Gateway<br/>(Booking & Travel Market Data API)"]
    end

    %% Client calls
    FE_Customer --> Gateway
    FE_Host --> Gateway
    FE_Admin --> Gateway

    Gateway --> CoreBackend

    %% Internal Communication
    Module_Verification -->|HTTP REST /internal/ai| CV_Engine
    Module_Property -->|Upload Signed Media| Cloudinary_Storage
    Module_Auth -->|Encrypt/Decrypt PII| DB_MySQL
    Module_Booking -->|SELECT ... FOR UPDATE| DB_MySQL
    Module_Payment -->|Create URL & Checksum| VNPay_Gateway
    VNPay_Gateway -->|Webhook IPN| Module_Payment
    Module_Refund -->|Escrow Refund Action| DB_MySQL
    Module_Finance -->|Payout Query| DB_MySQL

    %% AI & Data Communication
    Worker_RapidAPI -->|Lấy dữ liệu chuẩn hóa REST| RapidAPI_Gateway
    Worker_RapidAPI -->|Enrichment SĐT/GPS| Google_Maps_API
    Worker_RapidAPI -->|Lưu tĩnh & Đồng bộ giá TTL 6h| DB_MySQL
    ML_Engine -->|Truy vấn CompSet & Occupancy| DB_MySQL
    NLP_Engine -->|Ghi điểm cảm xúc Review| DB_MySQL
    CoreBackend -->|Query RAG & Recommendation| AIService
```

---

## 2. NGUYÊN TẮC THIẾT KẾ CỐT LÕI (DESIGN PRINCIPLES)

1. **Zero-Trust Client (Không tin tưởng phía Client)**:
   - Toàn bộ số tiền đơn hàng, lịch giá, phí hoa hồng, trạng thái xác thực và phân quyền đều do Backend NestJS tự tính toán từ Database MySQL. Client không có quyền gửi tổng tiền `total_amount` lên server.
2. **Nguyên tắc Đồng nhất (Unified Pipeline)**:
   - Không tạo luồng riêng rẽ cho Host Đăng mới và Host Claim nhà cào. Cả hai cùng đi qua một **Pipeline Xác thực 4 bước (Trust Score 140 điểm)**: CCCD (+40đ) + OTP (+30đ) + GPS Haversine (+30đ) + AI Live Vision (+40đ).
3. **Mô hình Dòng tiền Ký quỹ (Escrow Model)**:
   - Tiền thanh toán của khách qua VNPay luôn nằm tại tài khoản Sàn (Escrow). Sàn chỉ giải ngân cho Host sau 24h kể từ khi khách Check-in thành công. Sàn trực tiếp hoàn tiền cho khách khi có yêu cầu hủy hợp lệ theo chính sách của phòng.
4. **Bảo mật Dữ liệu Nhạy cảm (PII & PCI-DSS Compliance)**:
   - Số CCCD, đường dẫn ảnh CCCD và Số tài khoản ngân hàng của Host bắt buộc mã hóa đối xứng **AES-256-CBC** trước khi ghi vào MySQL.
   - Ảnh CCCD lưu trữ tại Cloudinary ở chế độ **Private (Authenticated)**, chỉ xem được qua URL tạm thời có gắn chữ ký số của Admin.
5. **Cơ chế Khóa dòng Chống Overbooking (Pessimistic Concurrency)**:
   - Sử dụng cú pháp chuẩn của MySQL 8.0 InnoDB `SELECT ... FOR UPDATE` trong Transaction khi khách tạo đơn đặt phòng, đảm bảo loại bỏ hoàn toàn tình trạng 2 khách đặt trùng 1 phòng vào cùng thời điểm.
6. **Chiến lược Thu thập Dữ liệu & Tối ưu Request (RapidAPI & 2-Tier Data Strategy)**:
   - Thay vì cào HTML trực tiếp từ Booking.com dễ bị Cloudflare / Bot detection chặn, hệ thống tích hợp API bên thứ ba là **RapidAPI (Travel & Booking Data Engine)** trả về định dạng RESTful JSON chuẩn hóa, an toàn và ổn định.
   - Áp dụng triệt để mô hình 2 tầng dữ liệu:
     + **Tầng Dữ liệu Tĩnh** (Tên homestay, địa chỉ, tọa độ GPS, album ảnh gốc, danh mục tiện nghi): Chỉ thu thập 1 lần duy nhất và lưu cố định vào MySQL (vĩnh viễn không gọi lại API ngoài để tối ưu quota request).
     + **Tầng Dữ liệu Động** (Giá phòng hôm nay/cuối tuần, Tỷ lệ phòng kín Occupancy Rate của các homestay đối thủ xung quanh): Bắt buộc cập nhật để nuôi thuật toán AI Dynamic Pricing. Áp dụng cơ chế **Cache hết hạn TTL 6 tiếng (On-Demand)** khi Host mở bảng lịch giá kết hợp **Cronjob ngầm lúc 02:00 sáng** mỗi ngày quét dữ liệu 7-14 ngày tới.

