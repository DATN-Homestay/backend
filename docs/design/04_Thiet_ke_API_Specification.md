# ĐẶC TẢ API HỆ THỐNG (API SPECIFICATIONS & CONTRACTS)
**Chuẩn thiết kế**: RESTful API, JSON Payload, Mã hóa UTF-8  
**Authentication**: JWT Bearer Token (`Authorization: Bearer <access_token>`)  
**Base URL Core Backend**: `http://localhost:3000/api/v1`  
**Base URL AI Service**: `http://localhost:8000/api/ai`

---

## 1. PHÂN HỆ AUTHENTICATION & SECURITY

### `POST /auth/register`
Đăng ký tài khoản người dùng mới.
* **Headers**: `Content-Type: application/json`
* **Request Body**:
  ```json
  {
    "email": "customer@example.com",
    "password": "SecurePassword123!",
    "full_name": "Nguyễn Văn A",
    "phone_number": "0912345678",
    "role": "CUSTOMER" // hoặc "HOST"
  }
  ```
* **Response (201 Created)**:
  ```json
  {
    "statusCode": 201,
    "message": "Đăng ký tài khoản thành công",
    "data": {
      "user_id": 15,
      "email": "customer@example.com",
      "full_name": "Nguyễn Văn A"
    }
  }
  ```

### `POST /auth/login`
Đăng nhập lấy Access Token và Refresh Token.
* **Request Body**:
  ```json
  {
    "email": "customer@example.com",
    "password": "SecurePassword123!"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "data": {
      "access_token": "eyJhbGciOiJIUzI1NiIsInR5c...",
      "refresh_token": "def50200...",
      "expires_in": 3600,
      "user": {
        "id": 15,
        "email": "customer@example.com",
        "roles": ["CUSTOMER"]
      }
    }
  }
  ```

---

## 2. PHÂN HỆ XÁC THỰC 4 LỚP ĐỒNG NHẤT (UNIFIED VERIFICATION ENGINE)

### `POST /host/verify/cccd` (Bước 1: CCCD eKYC +40đ)
Tải ảnh 2 mặt CCCD, mã hóa AES-256 và bóc tách thông tin.
* **Headers**: `Authorization: Bearer <token>`, `Content-Type: multipart/form-data`
* **Form-Data**:
  - `front_image`: File (ảnh mặt trước CCCD)
  - `back_image`: File (ảnh mặt sau CCCD)
  - `cccd_number`: "038099001234"
  - `full_name`: "NGUYEN VAN A"
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "data": {
      "step": 1,
      "score_earned": 40,
      "total_score": 40,
      "cccd_verified": true,
      "message": "Định danh CCCD thành công và đã được mã hóa an toàn."
    }
  }
  ```

### `POST /host/verify/send-otp` & `POST /host/verify/check-otp` (Bước 2: OTP +30đ)
* **Request check-otp**:
  ```json
  {
    "homestay_id": 42,
    "otp_code": "849201"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "data": {
      "step": 2,
      "score_earned": 30,
      "total_score": 70,
      "otp_verified": true
    }
  }
  ```

### `POST /host/verify/gps` (Bước 3: GPS Haversine +30đ)
* **Request Body**:
  ```json
  {
    "homestay_id": 42,
    "latitude": 11.94041920,
    "longitude": 108.45831200
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "data": {
      "step": 3,
      "distance_meters": 45.2,
      "score_earned": 30,
      "total_score": 100,
      "gps_verified": true,
      "message": "Khoảng cách thực địa hợp lệ (45.2m <= 150m)."
    }
  }
  ```

### `POST /host/verify/live-image` (Bước 4: Camera Live AI CLIP +40đ)
* **Form-Data**: `homestay_id`: 42, `live_image`: File (chụp từ Camera)
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "data": {
      "step": 4,
      "cosine_similarity": 0.8354,
      "score_earned": 40,
      "total_score": 140,
      "final_status": "AUTO_APPROVED",
      "is_claimed": 1,
      "message": "Xác thực 4 lớp thành công 140/140 điểm. Homestay đã được cấp quyền chính chủ!"
    }
  }
  ```

---

## 3. PHÂN HỆ ĐẶT PHÒNG & KHÓA DÒNG MY-SQL (BOOKING ENGINE)

### `POST /bookings`
Tạo đơn đặt phòng và kích hoạt khóa dòng chống Overbooking.
* **Headers**: `Authorization: Bearer <token>`, `Content-Type: application/json`
* **Request Body**:
  ```json
  {
    "room_id": 10,
    "check_in_date": "2026-10-20",
    "check_out_date": "2026-10-22",
    "customer_note": "Cần nhận phòng sớm lúc 13h"
  }
  ```
* **Response (201 Created)**:
  ```json
  {
    "statusCode": 201,
    "data": {
      "booking_code": "BK202610168392",
      "room_name": "Phòng Deluxe Hướng Rừng Thông",
      "check_in_date": "2026-10-20",
      "check_out_date": "2026-10-22",
      "nights": 2,
      "total_amount": 1600000,
      "payment_deadline": "2026-10-16T09:45:00Z",
      "vnpay_url": "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_Amount=160000000&..."
    }
  }
  ```
* **Error (409 Conflict)**:
  ```json
  {
    "statusCode": 409,
    "error": "Conflict",
    "message": "Phòng đã có người giữ chỗ trong khoảng thời gian này, vui lòng chọn ngày hoặc phòng khác."
  }
  ```

---

## 4. PHÂN HỆ THANH TOÁN VNPAY & HOÀN TIỀN ESCROW

### `GET /vnpay/ipn` (Server-to-Server Webhook)
API nhận gọi ngầm tự động từ máy chủ VNPay để xác nhận giao dịch.
* **Query Params**: `vnp_Amount`, `vnp_TxnRef`, `vnp_SecureHash`, `vnp_ResponseCode`, ...
* **Response**:
  - Thành công: `{"RspCode": "00", "Message": "Confirm Success"}`
  - Gói tin trùng: `{"RspCode": "02", "Message": "Order already confirmed"}`
  - Sai chữ ký: `{"RspCode": "97", "Message": "Invalid Checksum"}`

### `POST /bookings/:id/cancel` (Hoàn tiền Escrow)
* **Request Body**:
  ```json
  {
    "cancellation_reason": "Có việc gia đình đột xuất"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "data": {
      "booking_code": "BK202610168392",
      "cancellation_policy": "FLEXIBLE",
      "refund_percentage": 100,
      "refund_amount": 1600000,
      "status": "CANCELLED",
      "message": "Hủy phòng thành công. 100% tiền phòng đã được Sàn hoàn trả về tài khoản ngân hàng của bạn."
    }
  }
  ```

---

## 5. PHÂN HỆ ĐỐI SOÁT & GIẢI NGÂN (FINANCE & ADMIN PAYOUT)

### `GET /admin/payouts/pending`
Lấy danh sách các khoản giải ngân cuối kỳ cần Admin kiểm tra.
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "data": [
      {
        "payout_id": 8,
        "host_id": 5,
        "host_name": "NGUYEN VAN A",
        "gross_revenue": 20000000,
        "commission_rate": 0.075,
        "commission_fee": 1500000,
        "net_payout": 18500000,
        "bank_account_number_decrypted": "0987654321",
        "bank_account_name": "NGUYEN VAN A",
        "bank_name": "Vietcombank",
        "cccd_name_match": true
      }
    ]
  }
  ```

### `POST /admin/payouts/:id/approve`
Admin xác nhận đã chuyển khoản thành công và tải lên biên lai ngân hàng.
* **Form-Data**: `receipt_file`: File ảnh ủy nhiệm chi ngân hàng
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "message": "Giải ngân thành công cho Host. Trạng thái đã chuyển sang APPROVED."
  }
  ```

---

## 6. PHÂN HỆ NỘI BỘ AI SERVICE (PYTHON FASTAPI)

### `POST /api/ai/ocr-cccd`
* **Input**: File ảnh CCCD 2 mặt
* **Output**:
  ```json
  {
    "is_clear": true,
    "laplacian_variance": 142.5,
    "id_number": "038099001234",
    "full_name": "NGUYEN VAN A",
    "dob": "1995-08-15"
  }
  ```

### `POST /api/ai/match-live-image`
* **Input**: `live_image` (chụp camera), `stock_images` (danh sách ảnh cào/gốc)
* **Output**:
  ```json
  {
    "cosine_similarity": 0.8124,
    "is_match": true,
    "threshold": 0.75
  }
  ```

### `POST /api/ai/rag-search`
* **Input**: `{"query": "Nhà gỗ Đà Lạt yên tĩnh cuối tuần có BBQ cho 4 người"}`
* **Output**:
  ```json
  {
    "extracted_filters": {
      "city": "Đà Lạt",
      "capacity": 4,
      "amenities": ["BBQ", "Nhà gỗ"]
    },
    "matched_homestay_ids": [12, 45, 88]
  }
  ```

### `POST /api/ai/dynamic-pricing/calculate`
Tính toán giá đề xuất thông minh dựa trên CompSet đa tiêu chí & Nhu cầu thị trường.
* **Request Body**:
  ```json
  {
    "base_price": 700000,
    "target_date": "2026-10-20",
    "target_homestay": {
      "id": 42,
      "lat": 11.9404,
      "lng": 108.4583,
      "capacity": 4,
      "amenities": ["Hồ bơi", "BBQ", "Bếp", "Wifi"]
    },
    "candidate_homestays": [
      {
        "id": 105,
        "lat": 11.9421,
        "lng": 108.4601,
        "capacity": 4,
        "amenities": ["Hồ bơi", "BBQ", "Wifi"],
        "price_on_date": 850000,
        "is_booked_on_date": true
      }
    ]
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "suggested_price": 826000,
    "comp_market_price": 850000,
    "change_percentage": 18.0,
    "occupancy_rate": 80.0,
    "similar_properties_count": 12,
    "explanation": "Tìm thấy 12 chỗ nghỉ tương tự bán kính 5km (giá TB 850,000đ). Tỷ lệ lấp đầy ngày 2026-10-20 đạt 80%. Gợi ý điều chỉnh +18%."
  }
  ```

---

## 7. PHÂN HỆ GỢI Ý GIÁ DÀNH CHO HOST (HOST PRICING API)

### `GET /host/pricing/suggestions`
Lấy gợi ý giá AI cho từng ngày trên lịch của Host.
* **Query Params**: `homestay_id=42`, `date=2026-10-20`
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "data": {
      "date": "2026-10-20",
      "current_price": 700000,
      "suggested_price": 826000,
      "change_percentage": 18.0,
      "explanation": "Tìm thấy 12 chỗ nghỉ tương tự bán kính 5km (giá TB 850,000đ). Tỷ lệ lấp đầy ngày 2026-10-20 đạt 80%. Gợi ý điều chỉnh +18%."
    }
  }
  ```

### `PUT /host/pricing/apply`
Host xác nhận đồng ý áp dụng mức giá gợi ý của AI.
* **Request Body**:
  ```json
  {
    "homestay_id": 42,
    "date": "2026-10-20",
    "new_price": 826000
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "message": "Áp dụng giá mới thành công cho ngày 2026-10-20."
  }
  ```

---

## 8. PHÂN HỆ CHAT REALTIME (REST API & WEBSOCKET GATEWAY)

### 8.1. Các Endpoint REST API

#### `POST /chat/conversations`
Bắt đầu cuộc trò chuyện với chủ nhà (hoặc lấy cuộc trò chuyện cũ nếu đã tồn tại).
* **Headers**: `Authorization: Bearer <token>`
* **Request Body**:
  ```json
  {
    "homestay_id": 42,
    "booking_id": 18 // optional
  }
  ```
* **Response (200 OK / 201 Created)**:
  ```json
  {
    "statusCode": 200,
    "data": {
      "conversation_id": 8,
      "homestay_id": 42,
      "homestay_name": "Mây Homestay Đà Lạt",
      "host": {
        "id": 5,
        "name": "Chị Lan (Chủ nhà)",
        "avatar": "https://res.cloudinary.com/.../host.jpg"
      }
    }
  }
  ```

#### `GET /chat/conversations`
Lấy danh sách các cuộc hội thoại của người dùng hiện tại (sắp xếp theo tin nhắn mới nhất).
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "data": [
      {
        "conversation_id": 8,
        "homestay_name": "Mây Homestay Đà Lạt",
        "partner_name": "Chị Lan (Chủ nhà)",
        "last_message": "Dạ nhà có sẵn bếp nướng BBQ và vỉ nướng anh/chị nhé!",
        "last_message_time": "2026-10-16T09:41:00Z",
        "unread_count": 0
      }
    ]
  }
  ```

#### `GET /chat/conversations/:id/messages`
Lấy lịch sử tin nhắn trong cuộc trò chuyện (hỗ trợ phân trang).
* **Query Params**: `page=1`, `limit=30`
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "data": {
      "messages": [
        {
          "id": 101,
          "sender_id": 15,
          "message_type": "TEXT",
          "content": "Nhà mình có bếp nướng BBQ và gia vị không ạ?",
          "media_url": null,
          "is_read": true,
          "created_at": "2026-10-16T09:40:00Z"
        },
        {
          "id": 102,
          "sender_id": 5,
          "message_type": "SMART_REPLY",
          "content": "Dạ nhà có sẵn bếp nướng BBQ và vỉ nướng anh/chị nhé!",
          "media_url": null,
          "is_read": true,
          "created_at": "2026-10-16T09:41:00Z"
        }
      ],
      "has_more": false
    }
  }
  ```

#### `POST /chat/upload-attachment`
Tải ảnh đính kèm trong khung chat lên Cloudinary.
* **Form-Data**: `file`: File ảnh (PNG/JPG/WebP)
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "data": {
      "media_url": "https://res.cloudinary.com/homestay/image/upload/chat_media_abc123.webp"
    }
  }
  ```

---

### 8.2. Đặc tả Sự kiện WebSocket Gateway (Socket.io Namespace `/chat`)
* **URL Kết nối**: `ws://localhost:3000/chat`
* **Xác thực kết nối**: Truyền JWT qua `auth.token`:
  ```javascript
  const socket = io('http://localhost:3000/chat', {
    auth: { token: 'eyJhbGciOiJIUzI1Ni...' }
  });
  ```

| Sự kiện (Event) | Hướng gửi | Payload | Mô tả |
| :--- | :--- | :--- | :--- |
| `join_conversation` | Client $\rightarrow$ Server | `{"conversation_id": 8}` | Tham gia vào Socket Room của cuộc trò chuyện |
| `send_message` | Client $\rightarrow$ Server | `{"conversation_id": 8, "content": "...", "message_type": "TEXT", "media_url": null}` | Gửi tin nhắn mới |
| `receive_message` | Server $\rightarrow$ Client | `{"message_id": 101, "conversation_id": 8, "sender_id": 15, "content": "...", "created_at": "..."}` | Broadcast tin nhắn đến đối phương trong room |
| `typing` | Client $\rightarrow$ Server | `{"conversation_id": 8, "is_typing": true}` | Báo trạng thái "đang gõ tin nhắn..." |
| `user_typing` | Server $\rightarrow$ Client | `{"conversation_id": 8, "user_id": 15, "is_typing": true}` | Hiển thị hiệu ứng 3 chấm "đang gõ..." |
| `mark_as_read` | Client $\rightarrow$ Server | `{"conversation_id": 8}` | Đánh dấu đã đọc các tin nhắn |
| `smart_reply_suggestions` | Server $\rightarrow$ Host Client | `{"conversation_id": 8, "suggestions": ["Câu 1", "Câu 2", "Câu 3"]}` | Bắn riêng 3 nút trả lời nhanh cho Host |

---

## 9. PHÂN HỆ ĐÁNH GIÁ & VÒNG ĐỜI LƯU TRÚ (STAY & REVIEW API)

### `PUT /host/bookings/:id/check-in`
Host xác nhận khách đã đến nhận phòng thực tế.
* **Headers**: `Authorization: Bearer <host_token>`
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "message": "Xác nhận nhận phòng thành công",
    "data": {
      "booking_id": 18,
      "status": "CHECKED_IN",
      "checked_in_at": "2026-10-20T14:15:00Z"
    }
  }
  ```

### `PUT /host/bookings/:id/check-out`
Host hoặc hệ thống xác nhận khách đã trả phòng, chuyển trạng thái đơn sang `COMPLETED`.
* **Headers**: `Authorization: Bearer <host_token>`
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "message": "Xác nhận trả phòng thành công. Đơn hàng hoàn tất.",
    "data": {
      "booking_id": 18,
      "status": "COMPLETED",
      "checked_out_at": "2026-10-22T11:45:00Z"
    }
  }
  ```

### `POST /bookings/:id/reviews`
Khách hàng gửi đánh giá sau khi hoàn tất lưu trú (Bắt buộc đơn phải ở trạng thái `COMPLETED`).
* **Headers**: `Authorization: Bearer <customer_token>`, `Content-Type: multipart/form-data`
* **Form-Data**:
  - `rating_overall`: 5 (số nguyên 1 đến 5)
  - `cleanliness_rating`: 5
  - `service_rating`: 5
  - `location_rating`: 4
  - `comment`: "Homestay rất đẹp và sạch sẽ, chị chủ thân thiện chuẩn bị sẵn than nướng BBQ!"
  - `photos`: Files (1 đến 3 ảnh chụp thực tế lúc ở)
* **Response (201 Created)**:
  ```json
  {
    "statusCode": 201,
    "message": "Đánh giá của bạn đã được ghi nhận thành công!",
    "data": {
      "review_id": 24,
      "booking_id": 18,
      "rating_overall": 5,
      "images": [
        "https://res.cloudinary.com/homestay/image/upload/review_pic1.webp",
        "https://res.cloudinary.com/homestay/image/upload/review_pic2.webp"
      ],
      "status": "APPROVED"
    }
  }
  ```
* **Error (403 Forbidden - Khi khách chưa hoàn tất Check-in & Check-out)**:
  ```json
  {
    "statusCode": 403,
    "error": "Forbidden",
    "message": "Bạn chỉ được phép đánh giá sau khi đã hoàn tất nhận phòng và trả phòng (Check-out) tại Homestay."
  }
  ```
* **Error (400 Bad Request - Khi đơn hàng đã được đánh giá trước đó)**:
  ```json
  {
    "statusCode": 400,
    "error": "Bad Request",
    "message": "Đơn đặt phòng này đã được đánh giá, mỗi chuyến đi chỉ được gửi 1 lần đánh giá."
  }
  ```

### `GET /homestays/:id/reviews`
Lấy danh sách các đánh giá hợp lệ của một Homestay (kèm điểm trung bình và phân tích).
* **Query Params**: `page=1`, `limit=10`
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "data": {
      "average_rating": 4.8,
      "total_reviews": 35,
      "sub_ratings": {
        "cleanliness": 4.9,
        "service": 4.8,
        "location": 4.7
      },
      "reviews": [
        {
          "review_id": 24,
          "customer_name": "Nguyễn Văn A",
          "customer_avatar": "https://res.cloudinary.com/.../avatar.jpg",
          "stay_date": "Tháng 10/2026",
          "rating_overall": 5,
          "comment": "Homestay rất đẹp và sạch sẽ, chị chủ thân thiện...",
          "photos": [
            "https://res.cloudinary.com/.../review_pic1.webp"
          ],
          "created_at": "2026-10-22T14:30:00Z"
        }
      ],
      "has_more": true
    }
  }
  ```

---

## 7. PHÂN HỆ ĐỊNH GIÁ ĐỘNG AI & ĐỒNG BỘ THỊ TRƯỜNG RAPIDAPI (`FLOW-06`, `REQ-021`, `BR-015`)

### `GET /host/pricing/suggestions`
Lấy mức giá đề xuất thông minh từ AI cho một ngày cụ thể (áp dụng Cache TTL 6 tiếng với RapidAPI).
* **Role**: `HOST`, `ADMIN`
* **Query Params**:
  - `homestay_id`: ID Homestay của Host
  - `date`: Ngày cần định giá (`YYYY-MM-DD`, ví dụ: `2026-10-20`)
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "data": {
      "homestay_id": 42,
      "date": "2026-10-20",
      "base_price": 700000,
      "suggested_price": 826000,
      "change_percentage": 18.0,
      "comp_set_stats": {
        "compset_size": 10,
        "market_avg_price": 850000,
        "occupancy_rate": 85.0
      },
      "ai_explanation": "Khu vực lân cận bán kính 3km có 10 homestay tương đồng đạt tỷ lệ kín phòng 85% do cuối tuần. Giá thị trường trung bình 850.000đ. Đề xuất tăng giá +18% để tối ưu doanh thu.",
      "cache_status": "CACHE_HIT"
    }
  }
  ```

### `PUT /host/pricing/apply`
Chủ nhà xác nhận áp dụng mức giá do AI đề xuất vào bảng lịch giá phòng.
* **Role**: `HOST`
* **Request Body**:
  ```json
  {
    "homestay_id": 42,
    "date": "2026-10-20",
    "applied_price": 826000
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "message": "Áp dụng giá mới thành công! Bảng lịch giá đã được cập nhật.",
    "data": {
      "homestay_id": 42,
      "date": "2026-10-20",
      "new_price": 826000,
      "is_ai_applied": 1
    }
  }
  ```

### `POST /admin/sync/rapidapi-market-data`
Endpoint chạy ngầm (Cronjob 02:00 AM) hoặc kích hoạt thủ công bởi Admin để quét giá 7-14 ngày tới.
* **Role**: `ADMIN`, `SYSTEM_CRON`
* **Request Body**:
  ```json
  {
    "city": "Đà Lạt",
    "forecast_days": 14
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "statusCode": 200,
    "message": "Đồng bộ dữ liệu giá và tỷ lệ kín phòng từ RapidAPI thành công",
    "data": {
      "synced_properties_count": 48,
      "updated_calendar_dates": 14,
      "execution_time_ms": 1450
    }
  }
  ```



