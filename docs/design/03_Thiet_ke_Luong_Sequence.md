# THIẾT KẾ CÁC LUỒNG NGHIỆP VỤ & SƠ ĐỒ TUẦN TỰ (SEQUENCE DIAGRAMS)
**Tài liệu tham chiếu**: `Homestay_All_in_One_Business_Requirements_v2.1.xlsx` (Sheet `03_Quy_trinh`, `04_Quy_tac`)

---

## 1. LUỒNG 1: XÁC THỰC 4 LỚP ĐỒNG NHẤT (CCCD + OTP + GPS + AI VISION)
Áp dụng chung cho cả **Chủ nhà đăng Homestay mới** và **Chủ nhà Claim homestay cào về** (`FLOW-02`, `FLOW-03`, `BR-003`).

```mermaid
sequenceDiagram
    autonumber
    actor Host as Chủ nhà (Host)
    participant FE as Host Extranet (Web)
    participant BE as Core Backend (NestJS)
    participant AI as AI Service (FastAPI)
    participant Cloud as Cloudinary Storage
    participant DB as MySQL 8.0

    Note over Host, DB: BƯỚC 1: ĐỊNH DANH PHÁP LÝ BẰNG CCCD (+40 điểm bắt buộc)
    Host->>FE: Tải ảnh 2 mặt CCCD, nhập Họ tên, Số CCCD
    FE->>BE: POST /api/host/verify/cccd (FormData)
    BE->>Cloud: Upload ảnh lên thư mục Private (Authenticated)
    Cloud-->>BE: Trả về secure_url
    BE->>AI: POST /api/ai/ocr-cccd (Check ảnh mờ & bóc tách 12 số CCCD)
    AI-->>BE: { valid: true, id_number: "038...", full_name: "NGUYEN VAN A" }
    BE->>BE: Mã hóa AES-256 số CCCD, URL ảnh & Băm SHA-256
    BE->>DB: Lưu vào HOST_VERIFICATION_DOCUMENTS, cấp +40đ
    BE-->>FE: Kết quả Bước 1 hợp lệ (Trust Score = 40đ)

    Note over Host, DB: BƯỚC 2: XÁC THỰC LIÊN LẠC QUA OTP (+30 điểm)
    FE->>BE: POST /api/host/verify/send-otp
    BE->>BE: Sinh mã OTP 6 số (180s), gửi tới crawled_phone (nếu Claim) hoặc SĐT đăng ký
    Host->>FE: Nhập 6 số OTP
    FE->>BE: POST /api/host/verify/check-otp { code }
    BE->>BE: Kiểm tra khớp mã OTP & hạn 180s
    BE->>DB: Cập nhật OTP Score (+30đ)
    BE-->>FE: Xác thực OTP thành công (Trust Score = 70đ)

    Note over Host, DB: BƯỚC 3: XÁC THỰC THỰC ĐỊA GPS HAVERSINE (+30 điểm)
    Host->>FE: Bấm "Xác nhận vị trí tại Homestay"
    FE->>FE: navigator.geolocation.getCurrentPosition()
    FE->>BE: POST /api/host/verify/gps { lat, lng }
    BE->>DB: Truy vấn GPS Homestay (cào về hoặc ghim bản đồ)
    BE->>BE: Tính khoảng cách d bằng công thức Haversine
    alt d <= 150 mét
        BE->>DB: Cập nhật GPS Score (+30đ)
        BE-->>FE: Vị trí hợp lệ d <= 150m (Trust Score = 100đ)
    else d > 150 mét
        BE-->>FE: Lệch vị trí thực địa > 150m (Cộng 0đ)
    end

    Note over Host, DB: BƯỚC 4: CHỤP ẢNH LIVE CAMERA ĐỐI CHIẾU AI (+40 điểm)
    Host->>FE: Mở Camera Live (capture=environment) chụp góc phòng thực tế
    FE->>BE: POST /api/host/verify/live-image (Upload ảnh Live)
    BE->>Cloud: Upload ảnh Live lên Cloudinary
    BE->>AI: POST /api/ai/match-live-image (Ảnh Live + Bộ ảnh phòng gốc)
    AI->>AI: Trích xuất Vector qua CLIP ViT-B/32, tính Cosine Similarity u.v
    alt Cosine Similarity >= 0.75
        AI-->>BE: { match: true, similarity: 0.82 }
        BE->>DB: Cập nhật Live Vision Score (+40đ)
    else Cosine Similarity < 0.75
        AI-->>BE: { match: false, similarity: 0.58 }
        BE->>DB: Cập nhật Live Vision Score (0đ)
    end

    Note over Host, DB: TỔNG KẾT & DUYỆT TỰ ĐỘNG (ENGINE CHẤM ĐIỂM)
    BE->>DB: Tính tổng điểm: CCCD (40đ) + OTP + GPS + Live Vision
    alt total_trust_score >= 100 VÀ có CCCD hợp lệ
        BE->>DB: Cập nhật homestay is_claimed = 1, host_id = chủ mới, status = ACTIVE
        BE-->>FE: AUTO_APPROVED: Chúc mừng! Homestay của bạn đã được kích hoạt chính chủ!
    else total_trust_score từ 70 đến 99
        BE->>DB: Trạng thái PENDING_ADMIN (Chuyển Admin xét duyệt thủ công)
        BE-->>FE: Hồ sơ đã gửi, Admin sẽ duyệt trong 24h
    else total_trust_score < 70
        BE-->>FE: Không đạt ngưỡng tin cậy tối thiểu, yêu cầu xác thực lại
    end
```

---

## 2. LUỒNG 2: ĐẶT PHÒNG CHÍNH CHỦ & KHÓA BI QUAN CHỐNG OVERBOOKING (`FLOW-04`, `BR-007`)

```mermaid
sequenceDiagram
    autonumber
    actor Guest1 as Khách hàng 1
    actor Guest2 as Khách hàng 2
    participant FE as Customer Web
    participant BE as Core Backend (NestJS)
    participant DB as MySQL 8.0 (InnoDB)
    participant VNP as Cổng VNPay Sandbox

    Note over Guest1, Guest2: Cả 2 khách cùng chọn 1 phòng trống duy nhất vào ngày 20/10/2026
    par Cùng bấm Đặt phòng ở cùng mili-giây
        Guest1->>FE: Bấm "Thanh toán ngay"
        FE->>BE: POST /api/bookings { room_id, date: 2026-10-20 }
    and
        Guest2->>FE: Bấm "Thanh toán ngay"
        FE->>BE: POST /api/bookings { room_id, date: 2026-10-20 }
    end

    Note over BE, DB: Khởi tạo MySQL Transaction & Khóa dòng
    BE->>DB: START TRANSACTION;
    BE->>DB: SELECT * FROM price_calendars WHERE room_id = 10 AND date = '2026-10-20' FOR UPDATE;
    
    Note over DB: Giao dịch của Khách 1 giữ khóa thành công trước.<br/>Giao dịch của Khách 2 bị Block chờ hàng đợi.

    BE->>BE: Tính tổng tiền Zero-Trust từ giá bảng price_calendars
    BE->>DB: UPDATE price_calendars SET is_available = 0, locked_until = NOW() + INTERVAL 15 MINUTE
    BE->>DB: INSERT INTO bookings (booking_code, status = 'PENDING_PAYMENT', total_amount)
    BE->>DB: COMMIT; (Khách 1 hoàn tất giữ chỗ, nhả khóa hàng đợi)

    BE->>VNP: Tạo URL thanh toán kèm chữ ký HMAC-SHA512
    BE-->>Guest1: Trả về vnpay_payment_url (Khách 1 được chuyển sang VNPay)

    Note over DB, Guest2: Giao dịch Khách 2 tiếp tục chạy sau khi Khách 1 đã Commit
    BE->>DB: Khách 2 đọc lại bản ghi vừa được cập nhật: is_available = 0
    BE->>DB: ROLLBACK;
    BE-->>Guest2: 409 Conflict: "Phòng vừa có người giữ chỗ, vui lòng chọn phòng khác!"
```

---

## 3. LUỒNG 3: THANH TOÁN VNPAY QUA IPN WEBHOOK & IDEMPOTENCY (`REQ-013`, `REQ-014`, `BR-010`, `BR-011`)

```mermaid
sequenceDiagram
    autonumber
    actor Guest as Khách hàng
    participant VNP as VNPay Gateway
    participant BE as Core Backend (NestJS)
    participant DB as MySQL 8.0

    Guest->>VNP: Quét mã QR / Nhập OTP Ngân hàng thanh toán thành công
    VNP-->>Guest: Hiển thị màn hình "Giao dịch thành công" trên App Ngân hàng

    Note over Guest, BE: Khách lỡ tay đóng trình duyệt (Return URL không gọi được)
    
    Note over VNP, BE: VNPay tự động gọi ngầm Webhook Server-to-Server (IPN)
    VNP->>BE: GET /api/vnpay/ipn?vnp_Amount=...&vnp_TxnRef=...&vnp_SecureHash=...
    
    BE->>BE: Bóc tách tham số, tính lại mã băm HMAC-SHA512 với vnp_HashSecret
    alt Sai chữ ký Checksum
        BE-->>VNP: { RspCode: "97", Message: "Invalid Checksum" }
    else Khớp chữ ký hợp lệ
        BE->>DB: SELECT status FROM bookings WHERE booking_code = vnp_TxnRef
        alt Đơn hàng đã ở trạng thái PAID trước đó (Gói tin IPN gửi trùng)
            BE-->>VNP: { RspCode: "02", Message: "Order already confirmed" } (Đảm bảo Idempotency)
        else Đơn hàng đang ở PENDING_PAYMENT
            BE->>DB: START TRANSACTION;
            BE->>DB: UPDATE bookings SET status = 'PAID', paid_at = NOW();
            BE->>DB: INSERT INTO payments (booking_id, vnp_transaction_no, amount, status = 'SUCCESS');
            BE->>DB: UPDATE price_calendars SET locked_until = NULL; (Chốt kín lịch chính thức)
            BE->>DB: COMMIT;
            BE-->>VNP: { RspCode: "00", Message: "Confirm Success" }
            BE->>BE: Bắn thông báo Socket.io / Email cho Khách và Host
        end
    end
```

---

## 4. LUỒNG 4: HỦY PHÒNG & HOÀN TIỀN KÝ QUỸ ESCROW (`BR-021`, `FLOW-11`)

```mermaid
sequenceDiagram
    autonumber
    actor Guest as Khách hàng
    participant FE as Customer Web
    participant BE as Core Backend (NestJS)
    participant DB as MySQL 8.0
    actor Host as Chủ nhà (Host)

    Guest->>FE: Bấm "Yêu cầu hủy phòng" trên đơn đã thanh toán
    FE->>BE: POST /api/bookings/:id/cancel { reason }
    
    BE->>DB: Lấy thông tin booking (check_in_date, total_amount, cancellation_policy)
    BE->>BE: Tính khoảng thời gian Delta_Hours = (check_in_date - NOW())
    
    Note over BE: Áp dụng quy tắc hoàn tiền theo Cancellation Policy của Homestay
    alt Linh hoạt (FLEXIBLE) và Delta_Hours >= 24h
        BE->>BE: Tỷ lệ hoàn 100% (refund_amount = total_amount)
    else Tiêu chuẩn (MODERATE) và Delta_Hours từ 24h đến 120h (5 ngày)
        BE->>BE: Tỷ lệ hoàn 50% (refund_amount = total_amount * 0.5)
        BE->>BE: 50% còn lại trừ hoa hồng 7.5% chuyển cho Host đền bù
    else Nghiêm ngặt (STRICT) và Delta_Hours < 168h (7 ngày)
        BE->>BE: Tỷ lệ hoàn 0% (Không hoàn lại)
    end

    BE->>DB: START TRANSACTION;
    BE->>DB: UPDATE bookings SET status = 'CANCELLED';
    BE->>DB: UPDATE price_calendars SET is_available = 1 WHERE room_id = X AND date BETWEEN ...; (Mở lại phòng)
    BE->>DB: INSERT INTO refund_transactions (booking_id, refund_amount, status = 'PROCESSED');
    BE->>DB: COMMIT;

    BE->>BE: Kích hoạt hoàn tiền từ Tài khoản Escrow của Sàn về STK của Khách
    BE-->>FE: Thông báo: "Hủy phòng thành công. Tiền hoàn đã được gửi lại tài khoản của bạn."
```

---

## 5. LUỒNG 5: ĐỐI SOÁT HOA HỒNG 7.5% & GIẢI NGÂN MAKER-CHECKER KHỚP CCCD (`REQ-016`, `BR-013`, `BR-020`)

```mermaid
sequenceDiagram
    autonumber
    actor Cron as Background Scheduler
    participant BE as Core Backend (NestJS)
    participant DB as MySQL 8.0
    actor Admin as Admin Kế toán (Checker)
    actor Host as Chủ nhà (Host)

    Note over Cron, BE: BƯỚC 1: HỆ THỐNG TỰ ĐỘNG TỔNG HỢP (MAKER)
    Cron->>BE: Kích hoạt tác vụ cuối kỳ (Ngày 1 hàng tháng)
    BE->>DB: Query các đơn hàng COMPLETED trong tháng của từng Host
    BE->>BE: Tính gross_revenue = Tổng tiền phòng
    BE->>BE: Tính commission_fee = gross_revenue * 0.075 (Hoa hồng 7.5%)
    BE->>BE: Tính net_payout = gross_revenue - commission_fee - phạt_hủy (nếu có)
    
    BE->>DB: Đối chiếu Họ tên trên CCCD của Host với Tên chủ tài khoản Ngân hàng
    alt Tên chủ tài khoản lệch với Họ tên CCCD
        BE->>DB: Gắn cờ cảnh báo BLOCKED_NAME_MISMATCH, khóa quyền rút tiền
    else Tên khớp 100%
        BE->>DB: INSERT INTO payout_requests (host_id, gross_revenue, commission_fee, net_payout, status = 'PENDING')
    end

    Note over Admin, Host: BƯỚC 2: ADMIN KIỂM DUYỆT & GIẢI NGÂN (CHECKER)
    Admin->>BE: GET /api/admin/payouts/pending
    BE->>BE: Giải mã AES-256 số tài khoản ngân hàng của Host
    BE-->>Admin: Hiển thị bảng kê chi tiết + STK đã giải mã + xác nhận khớp tên CCCD
    
    Admin->>Admin: Thực hiện lệnh chuyển khoản qua Internet Banking của Sàn
    Admin->>BE: POST /api/admin/payouts/:id/approve (Upload ảnh biên lai ủy nhiệm chi)
    BE->>DB: UPDATE payout_requests SET status = 'APPROVED', receipt_image_url = '...', checker_admin_id = ...
    BE->>BE: Bắn thông báo biến động số dư cho Host
    Host-->>BE: Xem lịch sử Payout và tải biên lai đối soát
```

---

## 6. LUỒNG 6: GỢI Ý GIÁ ĐỘNG BẰNG AI & ĐỒNG BỘ THỊ TRƯỜNG RAPIDAPI (`FLOW-06`, `REQ-021`, `BR-015`)

### Cơ chế 2 tầng dữ liệu & Chiến lược gọi RapidAPI:
1. **Dữ liệu Tĩnh (Chỉ lấy 1 lần duy nhất)**: Tên, địa chỉ, GPS, tiện nghi, album ảnh gốc -> Lưu vào DB, vĩnh viễn không gọi lại API ngoài.
2. **Dữ liệu Động (Cập nhật nuôi AI Dynamic Pricing)**: Giá hôm nay/cuối tuần và tỷ lệ phòng kín ($Occ$) của cụm đối thủ (CompSet 3-5km):
   - **Thời điểm 1 (On-Demand with TTL 6h)**: Khi Host mở bảng giá và bấm "Nhận gợi ý AI", nếu `last_price_synced_at` cũ quá 6 tiếng thì BE mới gọi 1 request sang RapidAPI để lấy giá & phòng trống mới nhất. Nếu còn dưới 6h, lấy thẳng từ DB (0 tốn request).
   - **Thời điểm 2 (Cronjob 02:00 AM)**: Tự động chạy quét giá 7-14 ngày tới của các cụm homestay đối thủ.

```mermaid
sequenceDiagram
    autonumber
    actor Host as Chủ nhà (Host)
    participant FE as Host Extranet (Web)
    participant BE as Core Backend (NestJS)
    participant DB as MySQL 8.0
    participant RapidAPI as RapidAPI Travel Gateway
    participant AI as AI Service (FastAPI)

    Host->>FE: Mở Bảng Lịch giá (Price Calendar) & bấm "Gợi ý giá từ AI"
    FE->>BE: GET /api/v1/host/pricing/suggestions?homestay_id=42&date=2026-10-20
    
    BE->>DB: Lấy thông tin Homestay mục tiêu (GPS, P_base, last_price_synced_at)
    
    Note over BE: Kiểm tra Cache TTL (6 tiếng) của dữ liệu thị trường
    alt Dữ liệu cũ quá 6 tiếng hoặc chưa có dữ liệu ngày 20/10 (Cache Miss)
        BE->>RapidAPI: GET /trip/hotels/prices (Tọa độ GPS, radius=5km, date=2026-10-20)
        RapidAPI-->>BE: Trả về JSON danh sách giá phòng & trạng thái còn/hết phòng của các khách sạn/homestay lân cận
        BE->>DB: Cập nhật giá đối thủ & đánh dấu last_price_synced_at = NOW()
    else Dữ liệu được cập nhật trong vòng 6 tiếng (Cache Hit)
        Note over BE, DB: Tái sử dụng giá thị trường đã lưu trong MySQL (Tiết kiệm 100% request RapidAPI)
    end

    BE->>DB: Truy vấn 5-10 Homestay đối thủ CompSet (Haversine <= 5km)
    DB-->>BE: Danh sách giá P_i và trạng thái phòng trống ngày 20/10
    
    BE->>AI: POST /api/v1/ai/dynamic-pricing/calculate { P_base: 700000, comp_set: [...] }
    Note over AI: Thuật toán AI tính toán 3 chỉ số:<br/>1. Giá trung bình thị trường P_market = (1/N) * SUM(P_i)<br/>2. Tỷ lệ kín phòng Occ = (Số nhà hết phòng / Tổng số nhà)<br/>3. P_suggest = P_base * [1 + w1*NhuCau(Occ) + w2*ChenhLech(P_market) + w3*Weekend]<br/>4. Ràng buộc an toàn: Chặn cứng trong biên độ +-30% quanh P_base
    
    AI-->>BE: { suggested_price: 826000, change_pct: +18.0, p_market: 850000, occ_rate: 85.0, reason: "Khu vực lân cận 5km tỷ lệ kín phòng đạt 85% do cuối tuần..." }
    BE-->>FE: Trả về thông tin gợi ý giá kèm biểu đồ phân tích thị trường
    
    FE-->>Host: Hiển thị Popup gợi ý: "Đề xuất tăng +18% (700.000đ -> 826.000đ) vì khu vực kín 85% phòng"
    
    alt Host từ chối
        Host->>FE: Bấm "Giữ nguyên giá gốc"
        Note over Host, DB: Giữ nguyên mức giá cũ 700.000đ trên bảng price_calendars
    else Host đồng ý áp dụng
        Host->>FE: Bấm nút "Áp dụng giá mới"
        FE->>BE: PUT /api/v1/host/pricing/apply { homestay_id: 42, date: "2026-10-20", new_price: 826000 }
        BE->>DB: UPDATE price_calendars SET price = 826000, is_ai_applied = 1 WHERE homestay_id = 42 AND date = '2026-10-20'
        BE-->>FE: Cập nhật thành công! Lịch giá đã được đồng bộ cho khách đặt.
    end
```

---

## 7. LUỒNG 7: CHAT REALTIME & GỢI Ý CÂU TRẢ LỜI NHANH AI (SMART REPLY) (`REQ-022`, `BR-014`)

```mermaid
sequenceDiagram
    autonumber
    actor Guest as Khách hàng (Guest)
    participant FE_Guest as Customer Web (Socket)
    participant WS as ChatGateway (NestJS Socket.io)
    participant DB as MySQL 8.0
    participant AI as AI Service (FastAPI)
    participant FE_Host as Host Extranet (Socket)
    actor Host as Chủ nhà (Host)

    Note over Guest, FE_Host: KHỞI TẠO KẾT NỐI REALTIME QUA WEBSOCKET
    FE_Guest->>WS: Kết nối ws://... với handshake { auth: { token: JWT } }
    WS->>WS: Xác thực JWT token, lấy user_id = 15 (Guest)
    FE_Host->>WS: Kết nối ws://... với handshake { auth: { token: JWT } }
    WS->>WS: Xác thực JWT token, lấy user_id = 5 (Host)

    FE_Guest->>WS: emit('join_conversation', { conversation_id: 8 })
    WS->>WS: Cho socket của Guest join Room `conv_8`
    FE_Host->>WS: emit('join_conversation', { conversation_id: 8 })
    WS->>WS: Cho socket của Host join Room `conv_8`

    Note over Guest, FE_Host: KHÁCH GỬI TIN NHẮN HỎI TIỆN NGHI
    Guest->>FE_Guest: Gõ: "Nhà mình có bếp nướng BBQ và gia vị không ạ?"
    FE_Guest->>WS: emit('send_message', { conversation_id: 8, content: "Nhà mình có bếp nướng BBQ và gia vị không ạ?" })
    
    WS->>DB: INSERT INTO messages (conversation_id, sender_id, receiver_id, content, is_read = 0)
    WS->>DB: UPDATE conversations SET last_message_content = ..., unread_count_host = unread_count_host + 1
    
    WS-->>FE_Host: emit('receive_message', { message_id: 101, sender: "Khách", content: "Nhà mình có bếp nướng..." })
    FE_Host-->>Host: Chuông báo & hiển thị tin nhắn mới trên khung chat

    Note over WS, Host: KÍCH HOẠT AI SMART REPLY (GỢI Ý PHẢN HỒI NHANH CHO HOST)
    par Xử lý bất đồng bộ sinh Smart Reply
        WS->>DB: Lấy amenities_json và rules_json của homestay đang trao đổi
        DB-->>WS: amenities: ["Bếp nướng BBQ", "Bếp nấu", "Sân vườn", "Gia vị tự chuẩn bị"]
        WS->>AI: POST /api/ai/smart-reply { question: "Nhà mình có bếp nướng BBQ...", amenities, rules }
        Note over AI: Đối chiếu câu hỏi với tiện nghi thật (Anti-hallucination):<br/>- BBQ: Có<br/>- Gia vị: Khách tự chuẩn bị<br/>Sinh 3 gợi ý ngắn gọn.
        AI-->>WS: { suggestions: ["Dạ nhà có sẵn bếp nướng BBQ và vỉ nướng anh/chị nhé!", "Dạ anh/chị cần chuẩn bị thêm gia vị riêng giúp em ạ.", "Dạ có sẵn sân nướng BBQ ngoài trời anh/chị nha!"] }
        WS-->>FE_Host: emit('smart_reply_suggestions', { conversation_id: 8, suggestions: [...] })
        FE_Host-->>Host: Hiển thị 3 nút bấm gợi ý màu xanh ngay dưới khung chat
    end

    Note over Host, Guest: HOST CHỌN PHẢN HỒI 1 CHẠM (KHÔNG CẦN GÕ CHỮ)
    Host->>FE_Host: Bấm vào nút gợi ý: "Dạ nhà có sẵn bếp nướng BBQ và vỉ nướng anh/chị nhé!"
    FE_Host->>WS: emit('send_message', { conversation_id: 8, message_type: 'SMART_REPLY', content: "Dạ nhà có sẵn bếp nướng..." })
    WS-->>FE_Guest: emit('receive_message', { sender: "Chủ nhà", content: "Dạ nhà có sẵn bếp nướng..." })
    FE_Guest-->>Guest: Hiển thị câu trả lời tức thì của Host
```

---

## 8. LUỒNG 8: XÁC NHẬN CHECK-IN, CHECK-OUT & ĐÁNH GIÁ (RATING & REVIEW) (`REQ-019`, `BR-018`)

```mermaid
sequenceDiagram
    autonumber
    actor Host as Chủ nhà (Host)
    actor Guest as Khách hàng (Guest)
    participant FE as Customer / Host Web
    participant BE as Core Backend (NestJS)
    participant Cloud as Cloudinary
    participant DB as MySQL 8.0
    participant AI as AI Service (FastAPI)

    Note over Host, DB: BƯỚC 1: XÁC NHẬN CHECK-IN KHI KHÁCH ĐẾN
    Guest->>Host: Đến Homestay nhận phòng
    Host->>FE: Bấm "Xác nhận Khách đã Check-in" trên đơn PAID
    FE->>BE: PUT /api/host/bookings/:id/check-in
    BE->>DB: UPDATE bookings SET status = 'CHECKED_IN', checked_in_at = NOW()
    BE-->>FE: Cập nhật trạng thái CHECKED_IN thành công

    Note over Host, DB: BƯỚC 2: CHECK-OUT VÀ HOÀN TẤT ĐƠN HÀNG (COMPLETED)
    Guest->>Host: Trả chìa khóa rời đi
    alt Host hoặc Khách bấm Check-out
        Host->>FE: Bấm "Xác nhận Khách đã Check-out"
        FE->>BE: PUT /api/host/bookings/:id/check-out
    else Hoặc Cronjob quét tự động (12h00 trưa ngày check-out)
        BE->>BE: Cronjob tự động chuyển trạng thái đơn sang COMPLETED
    end
    BE->>DB: UPDATE bookings SET status = 'COMPLETED', checked_out_at = NOW()
    BE->>BE: Bắn thông báo mời khách đánh giá: "Cảm ơn bạn đã lưu trú! Hãy đánh giá trải nghiệm nhé."

    Note over Guest, DB: BƯỚC 3: KHÁCH HÀNG GỬI ĐÁNH GIÁ (KIỂM TRA ĐIỀU KIỆN CHẶT CHẼ)
    Guest->>FE: Mở đơn hàng COMPLETED, chấm 5 sao, viết nhận xét & tải 2 ảnh thực tế
    FE->>BE: POST /api/bookings/:id/reviews (FormData)
    
    BE->>DB: Kiểm tra: SELECT status, customer_id FROM bookings WHERE id = :id
    alt Đơn hàng CHƯA ở trạng thái COMPLETED (hoặc đã bị hủy)
        BE-->>FE: 403 Forbidden: "Bạn chỉ được đánh giá sau khi đã hoàn tất Check-in và Check-out thực tế."
    else Đơn hàng đã có đánh giá trong bảng reviews (trùng booking_id)
        BE-->>FE: 400 Bad Request: "Đơn hàng này bạn đã đánh giá rồi!"
    else Đơn hàng hợp lệ (COMPLETED & chưa review)
        BE->>Cloud: Upload 2 ảnh feedback thực tế của khách
        BE->>DB: INSERT INTO reviews (booking_id, customer_id, homestay_id, rating_overall = 5, comment = '...', review_images_json, status = 'APPROVED')
        BE-->>FE: 201 Created: "Đánh giá của bạn đã được ghi nhận!"

        Note over BE, AI: BƯỚC 4: KÍCH HOẠT HỌC MÁY QUÉT REVIEW RÁC & PHÂN TÍCH CẢM XÚC
        par Quét bất đồng bộ
            BE->>AI: POST /api/ai/scan-fraud (Isolation Forest kiểm tra tần suất spam review cùng IP)
            alt Phát hiện bất thường
                AI-->>BE: { is_outlier: true, score: -0.68 }
                BE->>DB: UPDATE reviews SET status = 'FLAGGED_FRAUD' (Ẩn review rác, cảnh báo Admin)
            else Review người thật hợp lệ
                BE->>AI: Background Job ABSA gom bình luận cập nhật Radar Chart 4 khía cạnh
            end
        end
    end
```



