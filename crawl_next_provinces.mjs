import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { ALL_LOCATIONS_LIST, POPULAR_DESTINATIONS } from './dist/modules/admin/vietnam-locations.data.js';

function getEnvConfig() {
  const envPath = path.resolve(process.cwd(), '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const config = {};
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...values] = trimmed.split('=');
    if (key && values.length > 0) {
      config[key.trim()] = values.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
  return config;
}

const env = getEnvConfig();

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getDefaultGroupedFacilities() {
  return {
    'Phòng tắm': [
      'Giấy vệ sinh',
      'Khăn tắm',
      'Bồn tắm hoặc vòi sen',
      'Dép lê',
      'Đồ vệ sinh cá nhân miễn phí',
      'Máy sấy tóc',
      'Phòng tắm riêng',
    ],
    'Phòng ngủ': ['Bộ khăn trải giường', 'Tủ hoặc phòng để quần áo', 'Bàn trang điểm'],
    'Ngoài trời': ['Bàn ghế ngoài trời', 'Khu vực ăn uống ngoài trời', 'Sân thượng / hiên', 'Sân vườn'],
    'Nhà bếp': ['Bàn ăn', 'Máy pha cà phê', 'Ấm đun nước điện', 'Tủ lạnh', 'Bếp nấu gia đình'],
    'Tiện ích trong phòng': ['Ổ cắm gần giường', 'Giá treo quần áo', 'Bàn làm việc', 'Bình chữa cháy'],
    'Truyền thông & Công nghệ': ['Dịch vụ phát trực tuyến (như Netflix)', 'TV màn hình phẳng', 'Truyền hình cáp'],
    'Đồ ăn & thức uống': ['Minibar', 'Nhà hàng', 'Máy pha trà/cà phê'],
    'Internet': ['Wi-fi tốc độ cao có ở toàn bộ khách sạn và miễn phí.'],
    'Chỗ đậu xe': ['Có chỗ đỗ xe riêng miễn phí tại chỗ (không cần đặt chỗ trước).'],
    'Dịch vụ lễ tân': ['Lễ tân 24 giờ', 'Bàn bán tour'],
  };
}

function buildRoomDetails(roomName, homestayName, rating, allPhotos, rIdx) {
  let area_sqm = 22;
  const lowerName = (roomName || '').toLowerCase();
  if (lowerName.includes('tiết kiệm') || lowerName.includes('standard') || lowerName.includes('tiêu chuẩn')) {
    area_sqm = 18 + (rIdx % 3) * 2;
  } else if (lowerName.includes('king') || lowerName.includes('deluxe')) {
    area_sqm = 26 + (rIdx % 3) * 2;
  } else if (lowerName.includes('3 người') || lowerName.includes('triple')) {
    area_sqm = 30 + (rIdx % 2) * 4;
  } else if (lowerName.includes('4 người') || lowerName.includes('gia đình') || lowerName.includes('family')) {
    area_sqm = 40 + (rIdx % 3) * 5;
  } else if (lowerName.includes('studio') || lowerName.includes('căn hộ') || lowerName.includes('apartment')) {
    area_sqm = 48 + (rIdx % 2) * 10;
  } else if (lowerName.includes('villa')) {
    area_sqm = 85 + (rIdx % 2) * 15;
  }

  let bed_info = '1 giường đôi lớn';
  if (lowerName.includes('king')) {
    bed_info = '1 giường đôi cực lớn (cỡ King)';
  } else if (lowerName.includes('3 người') || lowerName.includes('triple')) {
    bed_info = '1 giường đơn và 1 giường đôi lớn';
  } else if (lowerName.includes('4 người') || lowerName.includes('gia đình') || lowerName.includes('family')) {
    bed_info = '2 giường đôi lớn';
  } else if (lowerName.includes('đơn') || lowerName.includes('single') || lowerName.includes('twin')) {
    bed_info = '2 giường đơn';
  }

  const views = ['Nhìn ra thành phố', 'Nhìn ra sân vườn'];
  if (lowerName.includes('biển') || lowerName.includes('sea') || lowerName.includes('ocean')) {
    views.unshift('Nhìn ra biển');
  } else if (lowerName.includes('núi') || lowerName.includes('mountain')) {
    views.unshift('Nhìn ra cảnh núi non');
  } else if (lowerName.includes('hồ') || lowerName.includes('lake')) {
    views.unshift('Nhìn ra hồ nước');
  }

  const badges = [
    '1 phòng',
    `${area_sqm} m²`,
    views[0],
    'Phòng tắm riêng',
    'TV màn hình phẳng',
    'Cách âm',
    'Minibar',
    'WiFi miễn phí',
  ];

  const bedScore = Number(rating || 8.8).toFixed(1).replace('.', ',');

  return {
    area_sqm,
    bed_info,
    description: `Phòng nghỉ tiện nghi hiện đại với diện tích ${area_sqm}m², trang bị ${bed_info}, view thoáng mát ${views[0]}. Phòng tắm riêng có bồn tắm/vòi sen, máy sấy tóc và đồ vệ sinh cá nhân miễn phí.`,
    room_details_json: {
      badges,
      bed_rating_text: `Giường thoải mái, ${bedScore} - Dựa trên đánh giá thực tế`,
      bathroom_amenities: [
        'Đồ vệ sinh cá nhân miễn phí',
        'Khăn tắm',
        'Dép lê',
        'Máy sấy tóc',
        'Nhà vệ sinh',
        'Giấy vệ sinh',
        'Bồn tắm hoặc vòi sen',
      ],
      views,
      room_amenities: [
        'Bộ khăn trải giường',
        'Ấm đun nước điện',
        'Ổ cắm gần giường',
        'Tủ hoặc phòng để quần áo',
        'Bàn làm việc',
        'Cách âm',
        'TV màn hình phẳng',
        'Minibar',
        'Điều hòa nhiệt độ',
      ],
      smoking_policy: 'Không hút thuốc',
    },
    images: allPhotos.length > 0 ? allPhotos.slice(0, 10) : [],
  };
}

async function main() {
  console.log('========================================================================');
  console.log('   TIẾN TRÌNH CÀO DỮ LIỆU CÁC TỈNH THÀNH VIỆT NAM VÀO DATABASE AIVEN');
  console.log('========================================================================');

  const connection = await mysql.createConnection({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 16896),
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
    ssl: { rejectUnauthorized: false },
  });

  console.log('✓ Kết nối Database MySQL thành công!');

  const TARGET_MIN_PER_PROVINCE = 15;
  const now = new Date();
  const checkin = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const checkout = new Date(now.getTime() + 11 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`Ngày checkin: ${checkin} | checkout: ${checkout}`);
  console.log(`Chỉ tiêu tối thiểu mỗi tỉnh thành: ${TARGET_MIN_PER_PROVINCE} homestays`);
  console.log(`Tổng số tỉnh thành cấu hình: ${ALL_LOCATIONS_LIST.length} địa bàn\n`);

  let totalCrawledThisSession = 0;

  for (let pIdx = 0; pIdx < ALL_LOCATIONS_LIST.length; pIdx++) {
    const provinceName = ALL_LOCATIONS_LIST[pIdx];

    // Kiểm tra số lượng đã có trong DB
    const [countRows] = await connection.query(
      'SELECT COUNT(*) as count FROM homestays WHERE city = ?',
      [provinceName]
    );
    const existingCount = Number(countRows[0]?.count || 0);

    if (existingCount >= TARGET_MIN_PER_PROVINCE) {
      console.log(`[${pIdx + 1}/${ALL_LOCATIONS_LIST.length}] ${provinceName}: Đã có ${existingCount}/${TARGET_MIN_PER_PROVINCE} căn. (ĐẠT CHỈ TIÊU - BỎ QUA)`);
      continue;
    }

    const needed = TARGET_MIN_PER_PROVINCE - existingCount;
    console.log(`\n------------------------------------------------------------------------`);
    console.log(`>>> [${pIdx + 1}/${ALL_LOCATIONS_LIST.length}] BẮT ĐẦU CÀO [${provinceName}]`);
    console.log(`Hiện có: ${existingCount} căn. Cần cào thêm: ${needed} căn để đạt chỉ tiêu.`);

    const profileDir = path.resolve(process.cwd(), `.chrome-profile-${Date.now()}`);
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

    let browser = null;
    let savedInProvince = 0;

    try {
      browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        userDataDir: profileDir,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      );

      const searchUrl = `https://www.booking.com/searchresults.vi.html?ss=${encodeURIComponent(provinceName)}&checkin=${checkin}&checkout=${checkout}&group_adults=2&no_rooms=1`;
      console.log(`Tìm kiếm: ${searchUrl}`);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await delay(3500);

      const urlsToCrawl = await page.evaluate(() => {
        const links = document.querySelectorAll('a[data-testid="title-link"]');
        const list = [];
        links.forEach((l) => {
          if (l.href) {
            const clean = l.href.split('?')[0];
            if (!list.includes(clean)) list.push(clean);
          }
        });
        return list;
      });

      console.log(`Tìm thấy ${urlsToCrawl.length} cơ sở lưu trú tại ${provinceName}.`);

      for (const rawUrl of urlsToCrawl) {
        if (savedInProvince >= needed) break;

        // Bỏ qua nếu đã có trong CSDL
        const [dupRows] = await connection.query(
          'SELECT id FROM homestays WHERE source_url = ?',
          [rawUrl]
        );
        if (dupRows.length > 0) {
          continue;
        }

        const detailUrl = `${rawUrl}?checkin=${checkin}&checkout=${checkout}&group_adults=2&no_rooms=1`;
        try {
          await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await delay(3500);

          const detail = await page.evaluate(() => {
            let jsonLd = null;
            document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
              try {
                const p = JSON.parse(s.textContent);
                if (p['@type'] === 'Hotel' || p['@type'] === 'LodgingBusiness') jsonLd = p;
              } catch (e) {}
            });

            const name = jsonLd?.name || document.querySelector('#hp_hotel_name, h2.d2fee873cb')?.textContent?.trim() || '';
            const address = jsonLd?.address?.streetAddress || jsonLd?.address?.addressLocality || document.querySelector('.hp_address_subtitle')?.textContent?.trim() || '';
            const rating = jsonLd?.aggregateRating?.ratingValue || 9.0;
            const reviewCount = jsonLd?.aggregateRating?.reviewCount || 45;

            let lat = 11.9404;
            let lon = 108.4583;
            const mapLink = document.querySelector('a[data-atlas-latlng]');
            if (mapLink) {
              const parts = mapLink.getAttribute('data-atlas-latlng')?.split(',') || [];
              lat = parseFloat(parts[0]) || lat;
              lon = parseFloat(parts[1]) || lon;
            }

            const photos = [];
            document.querySelectorAll('img').forEach((img) => {
              const src = img.src || img.getAttribute('data-highres');
              if (src && src.includes('bstatic.com/xdata/images/hotel') && !src.includes('150x150') && !src.includes('square60')) {
                const highRes = src.replace(/max\d+(x\d+)?/, 'max1024x768').replace(/square\d+/, 'square1024');
                if (!photos.includes(highRes)) photos.push(highRes);
              }
            });

            const popularFacilities = [];
            const popWrapper = document.querySelector('[data-testid="property-most-popular-facilities-wrapper"]');
            if (popWrapper) {
              popWrapper.querySelectorAll('li, div[data-testid="facility-group-icon-and-title"]').forEach((el) => {
                const t = el.textContent?.trim();
                if (t && t.length > 2 && t.length < 50 && !t.includes('Các tiện nghi') && !popularFacilities.includes(t)) {
                  popularFacilities.push(t);
                }
              });
            }

            const scores = {
              cleanliness: 9.0,
              comfort: 9.0,
              facilities: 8.8,
              location: 9.0,
              staff: 9.2,
              value_for_money: 8.9,
              wifi: 9.2,
            };

            const scoreMapping = {
              'sạch sẽ': 'cleanliness',
              'thoải mái': 'comfort',
              'tiện nghi': 'facilities',
              'địa điểm': 'location',
              'nhân viên': 'staff',
              'đáng giá tiền': 'value_for_money',
              'wifi': 'wifi',
            };

            document.querySelectorAll('[data-testid="subscore-card"], .c-score-bar, [data-testid="review-subscore"]').forEach((bar) => {
              const text = bar.textContent?.toLowerCase() || '';
              const matchScore = bar.textContent?.match(/(\d+[,.]\d+)/);
              if (matchScore) {
                const val = parseFloat(matchScore[1].replace(',', '.'));
                for (const [key, prop] of Object.entries(scoreMapping)) {
                  if (text.includes(key)) {
                    scores[prop] = val;
                    break;
                  }
                }
              }
            });

            const rooms = [];
            const roomLinks = document.querySelectorAll('a.hprt-roomtype-link, [data-testid="room-name"], .rt-room-title');
            const prices = [];
            document.querySelectorAll('.prco-valign-middle-helper, [data-testid="price-and-discounted-price"]').forEach((p) => {
              const num = parseInt(p.textContent?.replace(/\D/g, '') || '', 10);
              if (num && num > 50000 && !prices.includes(num)) prices.push(num);
            });

            roomLinks.forEach((link, idx) => {
              const rName = link.textContent?.trim();
              if (rName && !rooms.some((x) => x.name === rName)) {
                rooms.push({
                  name: rName,
                  capacity: 2,
                  price: prices[idx] || prices[0] || 650000,
                });
              }
            });

            const groupedFacilities = {};
            document.querySelectorAll('.hotel-facilities-group, [data-testid="facility-group"]').forEach((g) => {
              const title = g.querySelector('.hotel-facilities-group__title, [data-testid="facility-group-title"], h5, h4')?.textContent?.trim();
              if (title) {
                const items = [];
                g.querySelectorAll('li, [data-testid="facility-item"]').forEach((it) => {
                  const txt = it.textContent?.trim();
                  if (txt && txt.length > 1 && txt !== title && !items.includes(txt)) {
                    items.push(txt);
                  }
                });
                if (items.length > 0) groupedFacilities[title] = items;
              }
            });

            return {
              name: name || 'Homestay Booking',
              address: address || '',
              lat,
              lon,
              rating: typeof rating === 'number' ? rating : parseFloat(rating) || 9.0,
              reviewCount: typeof reviewCount === 'number' ? reviewCount : parseInt(reviewCount, 10) || 50,
              photos: photos.slice(0, 10),
              popularFacilities,
              groupedFacilities,
              scores,
              rooms: rooms.length > 0 ? rooms : [{ name: 'Phòng Nghỉ Tiêu Chuẩn', capacity: 2, price: prices[0] || 650000 }],
            };
          });

          if (!detail.name || detail.name === 'Homestay Booking') {
            continue;
          }

          // Phân loại kiểu chỗ ở
          const lowerName = detail.name.toLowerCase();
          let pType = 'HOMESTAY';
          if (lowerName.includes('villa')) pType = 'VILLA';
          else if (lowerName.includes('studio')) pType = 'STUDIO';
          else if (lowerName.includes('apartment') || lowerName.includes('căn hộ') || lowerName.includes('residence')) pType = 'APARTMENT';

          const hotelIdMatch = rawUrl.match(/-(\d+)\./) || rawUrl.match(/hotel_id=(\d+)/);
          const hotelId = hotelIdMatch ? hotelIdMatch[1] : String(Date.now()).slice(-8);

          const starRating = Number((detail.rating > 5 ? detail.rating / 2 : detail.rating).toFixed(1));
          const address = detail.address || `${provinceName}, Việt Nam`;
          const ward = address.includes(',') ? address.split(',')[0].trim() : 'Trung tâm';

          const amenitiesJson = {
            property_type: pType,
            ward,
            hotel_id: hotelId,
            main_image_url: detail.photos[0] || null,
            property_images: detail.photos,
            items: detail.popularFacilities.length > 0 ? detail.popularFacilities.slice(0, 8) : [
              'Wifi tốc độ cao miễn phí',
              'Bếp nấu gia đình',
              'Điều hòa 2 chiều',
              'Bình nóng lạnh',
              'Chỗ đỗ xe ô tô',
              'Ban công view thoáng mát',
            ],
            popular_facilities: detail.popularFacilities,
            grouped_facilities: Object.keys(detail.groupedFacilities).length > 0
              ? detail.groupedFacilities
              : getDefaultGroupedFacilities(),
            review_scores: detail.scores,
          };

          const rulesJson = {
            checkin: '14:00',
            checkout: '12:00',
            pet_allowed: true,
          };

          // 1. Insert Homestay
          const [insertH] = await connection.query(
            `INSERT INTO homestays (
              name, address, city, latitude, longitude, source_url,
              is_claimed, host_id, average_rating, total_reviews,
              cancellation_policy, amenities_json, rules_json, status, last_price_synced_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, '1', ?, ?, 'FLEXIBLE', ?, ?, 'ACTIVE', NOW(), NOW(), NOW())`,
            [
              detail.name,
              address,
              provinceName,
              detail.lat,
              detail.lon,
              rawUrl,
              starRating,
              detail.reviewCount,
              JSON.stringify(amenitiesJson),
              JSON.stringify(rulesJson),
            ]
          );

          const homestayId = insertH.insertId;

          // 2. Insert Rooms, Room Images, Price Calendars
          for (let rIdx = 0; rIdx < detail.rooms.length; rIdx++) {
            const r = detail.rooms[rIdx];
            const rich = buildRoomDetails(r.name, detail.name, detail.rating, detail.photos, rIdx);

            const [insertR] = await connection.query(
              `INSERT INTO rooms (
                homestay_id, room_name, capacity, base_price, area_sqm, bed_info, description, room_details_json, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
              [
                homestayId,
                r.name,
                r.capacity,
                r.price,
                rich.area_sqm,
                rich.bed_info,
                rich.description,
                JSON.stringify(rich.room_details_json),
              ]
            );

            const roomId = insertR.insertId;

            const roomPhotos = (rich.images.length > 0 ? rich.images : detail.photos).slice(0, 10);
            for (let i = 0; i < roomPhotos.length; i++) {
              await connection.query(
                `INSERT INTO room_images (room_id, image_url, is_primary, sort_order, created_at)
                 VALUES (?, ?, ?, ?, NOW())`,
                [roomId, roomPhotos[i], i === 0 ? 1 : 0, i]
              );
            }

            await connection.query(
              `INSERT INTO price_calendars (room_id, date, price, is_available, created_at, updated_at)
               VALUES (?, ?, ?, 1, NOW(), NOW())`,
              [roomId, checkin, r.price]
            );
          }

          savedInProvince++;
          totalCrawledThisSession++;
          console.log(`  ✓ [${savedInProvince}/${needed}] Đã lưu: "${detail.name}" (${pType}) - Rating: ${detail.rating} (${detail.reviewCount} đánh giá) | ${detail.rooms.length} phòng | ${detail.photos.length} ảnh`);
        } catch (detailErr) {
          console.warn(`  ⚠️ Lỗi khi cào ${rawUrl}: ${detailErr.message}`);
        }
      }
    } catch (cityErr) {
      console.error(`Lỗi cào tỉnh [${provinceName}]: ${cityErr.message}`);
    } finally {
      if (browser) await browser.close().catch(() => null);
      try {
        if (fs.existsSync(profileDir)) {
          fs.rmSync(profileDir, { recursive: true, force: true });
        }
      } catch (e) {}
    }

    const [updatedCount] = await connection.query(
      'SELECT COUNT(*) as count FROM homestays WHERE city = ?',
      [provinceName]
    );
    console.log(`Hoàn tất [${provinceName}]: Hiện có ${updatedCount[0]?.count} căn trong CSDL.\n`);
  }

  const [finalTotal] = await connection.query('SELECT COUNT(*) as total FROM homestays');
  const [cityStats] = await connection.query('SELECT city, COUNT(*) as count FROM homestays GROUP BY city ORDER BY count DESC');

  console.log('\n========================================================================');
  console.log(`🎉 HOÀN TẤT PHIÊN CÀO! Tổng số căn mới lưu trong phiên: ${totalCrawledThisSession}`);
  console.log(`TỔNG CỘNG TRONG CSDL: ${finalTotal[0]?.total} homestays`);
  console.log('THỐNG KÊ CHI TIẾT THEO TỈNH THÀNH:');
  console.table(cityStats);
  console.log('========================================================================');

  await connection.end();
}

main().catch(console.error);
