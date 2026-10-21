# THIẾT KẾ THUẬT TOÁN & KIẾN TRÚC TRÍ TUỆ NHÂN TẠO (AI ALGORITHMS DESIGN)
**Service**: AI Microservice (Python FastAPI - Port 8000)  
**Tài liệu tham chiếu**: `Homestay_All_in_One_Business_Requirements_v2.1.xlsx` (Sheet `02_Yeu_cau`, `04_Quy_tac`)

---

## 1. THỊ GIÁC MÁY TÍNH (COMPUTER VISION ENGINE)

### 1.1. Thuật toán Đối chiếu Ảnh Live Camera & Ảnh Thương mại (CLIP ViT-B/32)
* **Bài toán (`REQ-009`, `BR-006`)**: Chống việc kẻ gian lấy ảnh đẹp trên mạng để tạo homestay ảo hoặc nhận vơ homestay cào về.
* **Mô hình sử dụng**: **OpenAI CLIP (Contrastive Language-Image Pre-Training) Model `ViT-B/32`**.
* **Công thức toán học**:
  - Gọi $\mathbf{u} \in \mathbb{R}^{512}$ là vector embedding trích xuất từ ảnh chụp trực tiếp tại hiện trường (Live Camera Image).
  - Gọi $\mathbf{v}_i \in \mathbb{R}^{512}$ ($i = 1 \dots k$) là vector embeddings của $k$ bức ảnh phòng thu thập từ RapidAPI Travel Gateway (hoặc ảnh thương mại Host tải lên).
  - Độ tương đồng ngữ cảnh không gian được tính bằng Cosine Similarity cực đại:
    $$\text{Similarity}_{\max} = \max_{i=1 \dots k} \left( \frac{\mathbf{u} \cdot \mathbf{v}_i}{\|\mathbf{u}\|_2 \cdot \|\mathbf{v}_i\|_2} \right)$$
* **Ngưỡng quyết định (Decision Threshold)**:
  - $\text{Similarity}_{\max} \ge 0.75$ (75%): Xác nhận ảnh chụp cùng một không gian $\rightarrow$ **Cộng +40 điểm vào Trust Score**.
  - $\text{Similarity}_{\max} < 0.75$: Không trùng khớp $\rightarrow$ Cộng 0 điểm.

```python
# Code minh họa trong FastAPI
import torch
import clip
from PIL import Image

device = "cuda" if torch.cuda.is_available() else "cpu"
model, preprocess = clip.load("ViT-B/32", device=device)

def calculate_live_similarity(live_img_path: str, stock_img_paths: list[str]) -> float:
    live_tensor = preprocess(Image.open(live_img_path)).unsqueeze(0).to(device)
    with torch.no_grad():
        live_feature = model.encode_image(live_tensor)
        live_feature /= live_feature.norm(dim=-1, keepdim=True)
        
        max_sim = 0.0
        for s_path in stock_img_paths:
            stock_tensor = preprocess(Image.open(s_path)).unsqueeze(0).to(device)
            stock_feature = model.encode_image(stock_tensor)
            stock_feature /= stock_feature.norm(dim=-1, keepdim=True)
            
            sim = torch.cosine_similarity(live_feature, stock_feature).item()
            if sim > max_sim:
                max_sim = sim
    return max_sim
```

### 1.2. Kiểm tra Ảnh mờ (Blur Detection) & AI OCR CCCD
* **Kiểm tra độ nét ảnh (`REQ-024`)**:
  - Sử dụng toán tử **Laplacian** trong OpenCV: $L(x, y) = \frac{\partial^2 I}{\partial x^2} + \frac{\partial^2 I}{\partial y^2}$.
  - Phương sai Laplacian: $\sigma^2 = \text{Var}(L)$. Nếu $\sigma^2 < 100 \rightarrow$ Ảnh bị mờ, từ chối ngay lập tức.
* **Bóc tách 12 số CCCD**:
  - Dùng **PaddleOCR / EasyOCR**: Bóc tách chuỗi 12 ký tự số (`\b\d{12}\b`), Họ tên và Ngày sinh để tự động điền vào Form xác thực.

---

## 2. XỬ LÝ NGÔN NGỮ TỰ NHIÊN (NLP & SEARCH ENGINE)

### 2.1. Thanh Tìm kiếm Tự nhiên Invisible RAG (`REQ-017`, `BR-014`)
* **Bài toán**: Khách hàng không cần tick hàng chục bộ lọc mà chỉ cần gõ: *"Nhà gỗ Đà Lạt yên tĩnh cuối tuần có BBQ cho 4 người"*.
* **Kiến trúc Pipeline**:
  ```text
  User Query ---> [FastAPI Entity Parser] ---> { city: 'Đà Lạt', capacity: 4, tags: ['BBQ', 'yên tĩnh'] }
                          │
                          ▼
            [SQL Server/MySQL Metadata Filter] ---> Danh sách phòng còn trống lịch
                          │
                          ▼
            [Vector Semantic Ranker] ---> Trả về Top 10 kết quả chuẩn xác nhất
  ```
* **Chống ảo giác (Anti-Hallucination)**: LLM chỉ đóng vai trò phân tích cấu trúc câu truy vấn (Entity Extractor), kết quả phòng và giá 100% được truy vấn từ bảng `price_calendars` và `homestays` trong MySQL.

### 2.2. Phân tích Cảm xúc Review Đa khía cạnh (ABSA) (`REQ-019`, `BR-016`)
* **Cơ chế chạy ngầm (Asynchronous Background Job)**:
  - Chạy lúc 00:00 hàng ngày hoặc khi homestay tích lũy thêm 5 bình luận mới.
  - Phân tích bình luận theo 4 khía cạnh:
    1. **Vệ sinh (Cleanliness)**: Điểm từ 1.0 đến 5.0
    2. **Độ ồn (Noise/Quietness)**: Điểm từ 1.0 đến 5.0
    3. **Dịch vụ & Thái độ Host (Service)**: Điểm từ 1.0 đến 5.0
    4. **Vị trí & Đường đi (Location)**: Điểm từ 1.0 đến 5.0
  - Lưu kết quả vào bảng `review_absa_metrics` $\rightarrow$ Khi khách xem chi tiết phòng, Frontend tải biểu đồ Radar Chart dưới **0.1s**, không nghẽn luồng.

### 2.3. Động cơ Gợi ý Câu Trả lời Nhanh (AI Smart Reply Engine) (`REQ-022`, `BR-014`)
* **Bài toán**: Chủ nhà thường xuyên nhận các câu hỏi lặp đi lặp lại về tiện nghi, giờ giấc check-in, nội quy (ví dụ: *"Có cho mang thú cưng không?", "Có bếp nướng BBQ không?", "Check-in sớm được không?"*).
* **Mô hình**: Kết hợp Phân loại Ý định (Intent Classification) & Prompt Context Retrieval:
  - Khi khách gửi tin nhắn, hệ thống trích xuất `intent` (Hỏi tiện nghi, Hỏi giờ giấc, Hỏi phụ phí).
  - Đối chiếu với dữ liệu thật trong `amenities_json` và `rules_json` của Homestay đó (Chống ảo giác theo `BR-014`).
  - Sinh 3 câu trả lời ngắn gọn (Short Candidates) có độ dài dưới 15 từ.
* **Output mẫu**:
  ```json
  {
    "detected_intent": "ASK_AMENITY_BBQ",
    "suggestions": [
      "Dạ nhà có sẵn bếp nướng BBQ và vỉ nướng anh/chị nhé!",
      "Dạ anh/chị cần tự chuẩn bị thêm than và gia vị nướng ạ.",
      "Dạ có khu vực nướng BBQ ngoài trời có mái che anh/chị nha!"
    ]
  }
  ```
* **Thời gian xử lý**: Dưới 300ms, gửi qua WebSocket event `smart_reply_suggestions` riêng cho màn hình Host.

---

## 3. HỌC MÁY TRUYỀN THỐNG (MACHINE LEARNING & ANOMALY DETECTION)

### 3.1. Thuật toán Rừng cô lập (Isolation Forest) Chống Gian lận (`REQ-026`, `FLOW-09`)
* **Mục tiêu**: Phát hiện đối thủ cố tình spam giữ chỗ rồi hủy, hoặc chủ nhà tự tạo nhiều tài khoản bơm đánh giá 5 sao ảo.
* **Vector đặc trưng hành vi (Feature Vector)**:
  $$\mathbf{x} = [f_{\text{booking\_1h}}, r_{\text{cancel}}, f_{\text{reviews}}, \text{ip\_entropy}, \text{device\_switch}]$$
* **Mô hình Scikit-Learn**:
  - `IsolationForest(n_estimators=100, contamination=0.03, random_state=42)`
  - Điểm bất thường (Anomaly Score) $s(\mathbf{x}, n) \in [-1, 1]$.
  - Nếu $s < -0.5 \rightarrow$ Bản ghi bị gắn nhãn `FLAGGED_FRAUD`, hiển thị cảnh báo đỏ trên màn hình Admin Security.

### 3.2. Động cơ Gợi ý Giá Động Đa Tiêu chí (AI Dynamic Pricing Engine) (`REQ-021`, `BR-015`, `P-05`)
Thuật toán giải quyết bài toán chủ nhà định giá cảm tính bằng cách phân tích **Độ tương đồng đa chiều của các đối thủ lân cận (vị trí địa lý, tiện nghi, dịch vụ, sức chứa)** kết hợp **Nhu cầu thị trường thời gian thực** để gợi ý giá tối ưu cho từng ngày.

#### A. Kiến trúc 2 Tầng Dữ liệu & Cơ chế Đồng bộ RapidAPI (2-Tier Data Strategy)
Để hệ thống vừa có dữ liệu thị trường mới nhất phục vụ AI, vừa không bị lãng phí request quota của API bên thứ ba:
1. **Dữ liệu Tĩnh (Chỉ đồng bộ 1 lần duy nhất)**:
   - Gồm: Tên chỗ nghỉ, Địa chỉ, Tọa độ GPS, Tiện nghi tĩnh, Album ảnh gốc, Số điện thoại.
   - Khi đã lưu vào MySQL, hệ thống **vĩnh viễn không gọi lại API ngoài** cho các trường dữ liệu này.
2. **Dữ liệu Động (Bắt buộc cập nhật liên tục để nuôi AI)**:
   - Gồm: Giá phòng hôm nay / cuối tuần này và Tỷ lệ kín phòng ($Occ$) của các homestay đối thủ lân cận (CompSet).
   - **Thời điểm 1: On-Demand with TTL 6 tiếng**:
     + Khi Host mở trang "Lịch giá" và bấm "Nhận gợi ý từ AI", Backend kiểm tra `last_price_synced_at`.
     + Nếu dữ liệu cập nhật **dưới 6 tiếng**: Tái sử dụng dữ liệu trong DB để AI tính toán ngay (**0 request RapidAPI**).
     + Nếu dữ liệu đã **cũ quá 6 tiếng** (hoặc chưa có giá ngày hôm nay): Backend gọi 1 request sang RapidAPI Travel Gateway lấy giá & phòng trống mới nhất, cập nhật vào bảng `price_calendars`, cập nhật `last_price_synced_at = NOW()`, rồi đưa cho AI xử lý.
   - **Thời điểm 2: Cronjob 02:00 sáng mỗi ngày (Scheduled Rolling Sync)**:
     + Chạy ngầm định kỳ quét giá 7-14 ngày tiếp theo cho cụm homestay đối thủ trong khu vực, giúp Host sáng thức dậy đã có sẵn gợi ý tối ưu.

#### B. Mô hình Xác định Tập Đối thủ Tương đồng (Competitive Set - CompSet Selection)
Không so sánh giá bừa bãi với các căn phòng khác loại, thuật toán xác định cụm đối thủ trong bán kính 3km - 5km và tính điểm tương đồng tổng hợp $W_i$ giữa Homestay mục tiêu ($H_{\text{target}}$) và từng Homestay đối thủ $H_i$:

1. **Khoảng cách Địa lý (Geo-Spatial Proximity)**:
   - Tính khoảng cách mặt cầu $d_i$ (Haversine) giữa 2 tọa độ GPS.
   - Hàm suy giảm theo khoảng cách (Exponential Distance Decay) trong bán kính $d_i \le 5\text{km}$:
     $$W_{\text{geo}}(i) = \exp\left( -\frac{d_i}{\sigma_{\text{dist}}} \right) \quad \text{với } \sigma_{\text{dist}} = 2.0\text{km}$$
     *(Nếu $d_i > 5\text{km}$ thì $W_{\text{geo}}(i) = 0$)*.

2. **Tương đồng về Tiện nghi & Dịch vụ (Amenity Jaccard Similarity)**:
   - Gọi $A_{\text{target}}$ và $A_i$ là tập các tiện nghi (Wifi, Bếp, BBQ, Hồ bơi, Máy lạnh, Bồn tắm, View núi...).
   - Áp dụng hệ số Jaccard có trọng số (Weighted Jaccard): Các tiện nghi cao cấp (Hồ bơi, BBQ, View) có trọng số $w_a = 2.0$, tiện nghi cơ bản có $w_a = 1.0$:
     $$S_{\text{amenity}}(i) = \frac{\sum_{a \in A_{\text{target}} \cap A_i} w_a}{\sum_{a \in A_{\text{target}} \cup A_i} w_a}$$

3. **Tương đồng về Sức chứa & Loại phòng (Capacity Match)**:
   $$S_{\text{capacity}}(i) = 1 - \frac{|\text{Cap}_{\text{target}} - \text{Cap}_i|}{\max(\text{Cap}_{\text{target}}, \text{Cap}_i)}$$

4. **Trọng số Tương đồng Tổng hợp (CompSet Weight)**:
   $$W_i = 0.40 \cdot W_{\text{geo}}(i) + 0.35 \cdot S_{\text{amenity}}(i) + 0.25 \cdot S_{\text{capacity}}(i)$$
   *(Chỉ chọn các đối thủ có $W_i \ge 0.55$, lấy Top $K = 5 \dots 10$ đối thủ tương đồng nhất trong bán kính 3km - 5km để đưa vào tập CompSet)*.

---

#### C. Bóc tách 2 Chỉ số Sống từ Dữ liệu Thị trường
1. **Giá trung bình thị trường ($P_{\text{market}}$ hay $P_{\text{comp}}$)**:
   $$P_{\text{market}}(T) = \frac{\sum_{i \in \text{CompSet}} W_i \cdot P_i(T)}{\sum_{i \in \text{CompSet}} W_i}$$
   *(Cho biết các homestay tương đồng xung quanh hôm nay đang bán trung bình bao nhiêu tiền/đêm)*.

2. **Tỷ lệ Kín phòng Khu vực (Occupancy Rate - $Occ$)**:
   $$\text{Occ}(T) = \frac{\text{Số homestay lân cận trong CompSet đã BÁO HẾT PHÒNG vào ngày } T}{\text{Tổng số homestay trong CompSet}}$$
   *(Nếu 10 nhà xung quanh mà 8 nhà đã kín chỗ $\rightarrow \text{Occ} = 80\% \rightarrow$ Thị trường đang cháy phòng cực mạnh)*.

---

#### D. Định lượng Nhu cầu Thị trường (Market Demand Factor $\Delta_{\text{demand}}$)
Hệ số co giãn nhu cầu thị trường được tổng hợp từ 3 yếu tố:
1. **Hệ số áp lực lấp đầy**:
   $$F_{\text{occ}} = 0.50 \times (\text{Occ}(T) - 0.50)$$
   *(Nếu $\text{Occ} \ge 80\%$ (Cháy phòng): $F_{\text{occ}} > 0 \rightarrow$ Kéo giá tăng. Nếu $\text{Occ} \le 20\%$ (Vắng khách): $F_{\text{occ}} < 0 \rightarrow$ Kéo giá giảm nhẹ để kích cầu)*.

2. **Yếu tố Lịch (Cuối tuần & Ngày lễ)**:
   $$F_{\text{calendar}} = \begin{cases} +0.15 & \text{nếu là Thứ Sáu hoặc Thứ Bảy} \\ +0.25 & \text{nếu là Ngày lễ, Tết} \\ 0 & \text{ngày trong tuần} \end{cases}$$

3. **Yếu tố Thời gian Đặt trước (Lead Time Factor)**:
   Gọi $L = T - \text{Ngày hiện tại}$ (số ngày còn lại):
   - Nếu $L \le 2$ ngày mà phòng vẫn trống $\rightarrow F_{\text{lead}} = -0.10$ (xả phòng phút chót).
   - Nếu $L \ge 14$ ngày $\rightarrow F_{\text{lead}} = +0.05$ (đặt xa ngày, giữ giá tốt).

$$\Delta_{\text{demand}} = F_{\text{occ}} + F_{\text{calendar}} + F_{\text{lead}}$$

---

#### E. Công thức Tính Giá Đề xuất & Giới hạn An toàn (Safety Guardrails)
1. **Giá tính toán ban đầu ($P_{\text{raw}}$)** kết hợp giữa Giá gốc của Host ($P_{\text{base}}$), Giá thị trường CompSet ($P_{\text{market}}$) và Hệ số nhu cầu:
   $$P_{\text{raw}}(T) = \left[ 0.60 \times P_{\text{base}} + 0.40 \times P_{\text{market}}(T) \right] \times (1 + \Delta_{\text{demand}})$$

2. **Ràng buộc an toàn cứng $\pm 30\%$ quanh giá gốc (`BR-015`)**:
   $$P_{\text{suggest}}(T) = \text{Round}\left( \max\left( 0.70 \times P_{\text{base}}, \, \min\left( 1.30 \times P_{\text{base}}, \, P_{\text{raw}}(T) \right) \right), \, -3 \right)$$
   *(Làm tròn đến hàng nghìn đồng, không bao giờ vượt quá biên độ $\pm 30\%$ so với giá gốc của Host, và chỉ thay đổi khi Host bấm "Đồng ý áp dụng")*.

---

#### F. Trí tuệ Nhân tạo Có Thể Giải Thích (Explainable AI - XAI)
Mỗi lần trả về giá gợi ý, thuật toán sinh kèm **lý do minh bạch bằng tiếng Việt** để Host hiểu tại sao nên điều chỉnh:
* Ví dụ: *"Tìm thấy 8 homestay lân cận bán kính 3km có tiện nghi tương đồng (Hồ bơi, BBQ, 4 khách) với giá trung bình 850.000đ. Tỷ lệ kín phòng ngày 20/10 đạt 85% (Nhu cầu cao). Gợi ý tăng giá +18% (từ 700.000đ lên 826.000đ)."*

```python
# Code minh họa trong AI Service (Python FastAPI)
import numpy as np

def calculate_dynamic_price(
    base_price: float,
    target_homestay: dict,
    candidate_homestays: list[dict],
    target_date: str
) -> dict:
    weights = []
    prices = []
    booked_count = 0

    for h in candidate_homestays:
        d_km = haversine_distance(target_homestay['lat'], target_homestay['lng'], h['lat'], h['lng'])
        if d_km > 5.0:
            continue
        w_geo = np.exp(-d_km / 2.0)
        
        # Jaccard amenities
        set_t = set(target_homestay['amenities'])
        set_h = set(h['amenities'])
        s_amenity = len(set_t & set_h) / max(1, len(set_t | set_h))
        
        # Capacity match
        s_cap = 1.0 - abs(target_homestay['capacity'] - h['capacity']) / max(target_homestay['capacity'], h['capacity'])
        
        w_total = 0.40 * w_geo + 0.35 * s_amenity + 0.25 * s_cap
        if w_total >= 0.55:
            weights.append(w_total)
            prices.append(h['price_on_date'])
            if h['is_booked_on_date']:
                booked_count += 1

    if not weights:
        return {"suggested_price": base_price, "reason": "Chưa đủ dữ liệu đối thủ lân cận"}

    # Giá thị trường bình quân gia quyền
    p_comp = np.average(prices, weights=weights)
    
    # Nhu cầu thị trường
    occ_rate = booked_count / len(weights)
    delta_demand = 0.5 * (occ_rate - 0.5)
    if is_weekend(target_date):
        delta_demand += 0.15

    # Tính giá thô & áp trần an toàn +-30%
    p_raw = (0.60 * base_price + 0.40 * p_comp) * (1 + delta_demand)
    min_safe = 0.70 * base_price
    max_safe = 1.30 * base_price
    p_final = int(round(np.clip(p_raw, min_safe, max_safe), -3))

    change_pct = round(((p_final - base_price) / base_price) * 100, 1)
    sign = "+" if change_pct > 0 else ""

    return {
        "suggested_price": p_final,
        "comp_market_price": int(round(p_comp, -3)),
        "change_percentage": change_pct,
        "occupancy_rate": round(occ_rate * 100, 1),
        "similar_properties_count": len(weights),
        "explanation": f"Tìm thấy {len(weights)} chỗ nghỉ tương tự bán kính 5km (giá TB {int(p_comp):,}đ). Tỷ lệ lấp đầy ngày {target_date} đạt {round(occ_rate*100)}%. Gợi ý điều chỉnh {sign}{change_pct}%."
    }
```
