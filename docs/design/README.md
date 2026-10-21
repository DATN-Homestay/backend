# BỘ TÀI LIỆU PHÂN TÍCH & THIẾT KẾ HỆ THỐNG (SYSTEM ANALYSIS & DESIGN - SADD)
**Đồ án tốt nghiệp**: SÀN GIAO DỊCH HOMESTAY LAI TÍCH HỢP TRÍ TUỆ NHÂN TẠO (HOMESTAY BOOKING & AI HYBRID MARKETPLACE)  
**Phiên bản chuẩn**: 2.1 | **Ngày hoàn thiện**: 16/10/2026  
**Tài liệu yêu cầu nghiệp vụ gốc**: [Homestay_All_in_One_Business_Requirements_v2.1.xlsx](file:///c:/Users/Admin/Desktop/graduate_project/backend/docs/Homestay_All_in_One_Business_Requirements_v2.1.xlsx)

---

## MỤC LỤC BỘ TÀI LIỆU THIẾT KẾ

| STT | Tài liệu thiết kế | Nội dung chính |
| :---: | :--- | :--- |
| **01** | [01_Kien_truc_tong_the.md](file:///c:/Users/Admin/Desktop/graduate_project/backend/docs/design/01_Kien_truc_tong_the.md) | Mô hình kiến trúc Modular Monolith (NestJS) + AI Microservice (Python FastAPI) + MySQL 8.0, sơ đồ khối toàn hệ thống, 5 nguyên tắc thiết kế bất khả xâm phạm. |
| **02** | [02_Thiet_ke_CSDL_Chi_tiet.md](file:///c:/Users/Admin/Desktop/graduate_project/backend/docs/design/02_Thiet_ke_CSDL_Chi_tiet.md) | Sơ đồ Mermaid ERD, Từ điển dữ liệu 34 bảng trong MySQL 8.0 (Data Types, Index, Khóa ngoại, trường mã hóa AES-256 cho CCCD/STK, cấu trúc bảng Lịch giá, Đặt phòng, Escrow). |
| **03** | [03_Thiet_ke_Luong_Sequence.md](file:///c:/Users/Admin/Desktop/graduate_project/backend/docs/design/03_Thiet_ke_Luong_Sequence.md) | Sơ đồ tuần tự (Sequence Diagrams) cho 8 luồng nghiệp vụ cốt lõi: Xác thực 4 lớp (Trust Score 140đ), Đặt phòng khóa dòng MySQL InnoDB, Thanh toán VNPay IPN, Hoàn tiền Escrow, Đối soát Maker-Checker hoa hồng 7.5%, AI Dynamic Pricing, Chat Realtime Smart Reply và Vòng đời Check-in/Check-out/Review sau lưu trú. |
| **04** | [04_Thiet_ke_API_Specification.md](file:///c:/Users/Admin/Desktop/graduate_project/backend/docs/design/04_Thiet_ke_API_Specification.md) | Đặc tả chi tiết chuẩn RESTful API, JSON Payload, Headers, DTOs, HTTP Status Codes cho toàn bộ các Endpoint của Backend NestJS và AI FastAPI. |
| **05** | [05_Kien_truc_AI_Algorithms.md](file:///c:/Users/Admin/Desktop/graduate_project/backend/docs/design/05_Kien_truc_AI_Algorithms.md) | Thiết kế toán học & mã nguồn mẫu cho các thuật toán AI: OpenAI CLIP ViT-B/32 so khớp ảnh Live, Laplacian Variance chống ảnh mờ, EasyOCR CCCD, Invisible RAG Search, Review ABSA Radar Chart, Isolation Forest chống gian lận. |
| **06** | [06_Bao_mat_Ha_tang.md](file:///c:/Users/Admin/Desktop/graduate_project/backend/docs/design/06_Bao_mat_Ha_tang.md) | Thiết kế mã hóa đối xứng AES-256-CBC, băm Blind Indexing SHA-256, Cloudinary Authenticated Signed URLs cho CCCD, Zero-Trust thanh toán, phân quyền RBAC RolesGuard, kết nối Aiven Cloud MySQL bảo mật SSL/TLS và Docker Compose. |

---

## 3 ĐIỂM SÁNG CỐT LÕI CỦA THIẾT KẾ ĐỒ ÁN (KEY HIGHLIGHTS)

1. **Cơ chế Xác thực 4 Lớp Đồng nhất (Unified Verification Pipeline - 140 điểm)**:
   - Dùng chung 1 thuật toán và 1 cơ chế cho cả *Host tạo Homestay mới* và *Host nhận quyền (Claim) Homestay cào về*:
     $$\text{Total Score} = \text{CCCD (40đ - Bắt buộc)} + \text{OTP (30đ)} + \text{GPS Haversine (30đ)} + \text{AI Live Camera (40đ)}$$
   - Đạt $\ge 100$ điểm tự động cấp tích xanh chính chủ (`is_claimed = 1`), từ 70–99 điểm chuyển Admin duyệt tay.

2. **Bảo mật Dòng tiền Chuẩn Quốc tế (Escrow & Zero-Trust & 7.5% Commission)**:
   - Toàn bộ tiền khách trả qua VNPay được giữ tại tài khoản Ký quỹ (Escrow) của Sàn, chỉ giải ngân cho Host sau 24h Check-in.
   - Sàn chủ động hoàn tiền cho khách khi hủy phòng theo chính sách (Linh hoạt/Tiêu chuẩn/Nghiêm ngặt).
   - Phí hoa hồng sàn cố định **7.5% (chỉ bằng một nửa mức 15% của Booking.com)**, tạo lợi thế cạnh tranh áp đảo.
   - Chống Overbooking bằng giao dịch khóa dòng MySQL InnoDB: `SELECT ... FOR UPDATE`.

3. **Kiến trúc Công nghệ Tách bạch, Dễ mở rộng & Sẵn sàng Triển khai**:
   - Backend NestJS (TypeScript) chuyên trách Nghiệp vụ, Database, Auth, Thanh toán.
   - AI Microservice (Python FastAPI) chuyên trách Model Inference nặng, Computer Vision và NLP.
   - 3 thành viên code chung 1 CSDL MySQL 8.0 Online trên Cloud Aiven (bảo mật SSL/TLS, hoạt động 24/7) và bàn giao hệ thống bằng `docker-compose.yml`.

4. **Giao tiếp Realtime & Trợ lý Phản hồi Nhanh (WebSocket Chat & AI Smart Reply)**:
   - Chat 2 chiều thời gian thực qua NestJS Socket.io Gateway, phân quyền bảo mật theo Room ID của từng cuộc hội thoại.
   - AI Smart Reply tự động đối chiếu tiện nghi và nội quy của Homestay để gợi ý 3 nút phản hồi nhanh 1 chạm cho Host, loại bỏ hoàn toàn hiện tượng bịa thông tin (Anti-Hallucination).

5. **Chiến lược Dữ liệu 2 Tầng & Định giá Động AI Thông minh (RapidAPI & AI Dynamic Pricing)**:
   - Loại bỏ hoàn toàn việc cào trực tiếp từ Booking.com (tránh lỗi bot detection/Cloudflare), chuyển sang tích hợp API bên thứ ba là **RapidAPI (Travel & Booking Data Engine)**.
   - Tách bạch **Dữ liệu Tĩnh** (lưu DB 1 lần duy nhất) và **Dữ liệu Động** (giá & tỷ lệ kín phòng Occupancy) để nuôi AI.
   - Cơ chế gọi thông minh: **Cache hết hạn TTL 6 tiếng khi Host yêu cầu (On-Demand)** kết hợp **Cronjob 02:00 sáng** định kỳ quét 7-14 ngày tới.
   - Thuật toán AI phân tích cụm đối thủ tương đồng CompSet 3-5km (Haversine GPS, Jaccard tiện nghi, sức chứa), công thức tính giá tối ưu $P_{\text{suggest}}$ bị chặn cứng trong biên độ an toàn $\pm 30\%$ quanh giá gốc (`BR-015`).


