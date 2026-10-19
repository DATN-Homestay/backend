import mysql from 'mysql2/promise';

const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';
const hotelId = '11925801';

async function syncAllRealPhotos() {
  console.log('--- 1. LẤY TOÀN BỘ ẢNH THẬT TỪ BOOKING.COM API (getHotelPhotos) ---');
  const photosUrl = `https://${host}/api/v1/hotels/getHotelPhotos?hotel_id=${hotelId}`;
  const resPhotos = await fetch(photosUrl, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const photosJson = await resPhotos.json();
  const allPhotosRaw = photosJson?.data || [];
  console.log(`Đã cào về được tổng cộng ${allPhotosRaw.length} ảnh thực tế của Carnival Villa từ Booking.com!`);

  // Chuẩn hóa URL sang kích thước chất lượng cao max1024x768
  const allHighResUrls = allPhotosRaw.map((p) => {
    return p.url.replace('square1024', 'max1024x768');
  });

  console.log('--- 2. LẤY 10 ẢNH THẬT RIÊNG CỦA PHÒNG TIÊU CHUẨN GIƯỜNG ĐÔI (getHotelDetails) ---');
  const detailUrl = `https://${host}/api/v1/hotels/getHotelDetails?hotel_id=${hotelId}&arrival_date=2026-11-01&departure_date=2026-11-02&adults=2&room_qty=1&units=metric&temperature_unit=c&languagecode=vi&currency_code=VND`;
  const resDetail = await fetch(detailUrl, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const detailJson = await resDetail.json();
  const d = detailJson?.data;
  const standardRoom = d?.rooms?.['1192580113'];
  const roomPhotos10 = (standardRoom?.photos || []).map((p) => {
    return (p.url_max1280 || p.url_original || p.url_max750).replace('max750', 'max1024x768');
  });
  console.log(`Đã lấy được ${roomPhotos10.length} ảnh chuẩn 100% của Phòng Tiêu Chuẩn Giường Đôi!`);

  console.log('--- 3. CẬP NHẬT DATABASE AIVEN MYSQL ---');
  const connection = await mysql.createConnection({
    host: 'homestay-nam0072004-b252.h.aivencloud.com',
    port: 16896,
    user: 'avnadmin',
    password: 'AVNS_EULEhrA6URi3BdcqYhi',
    database: 'defaultdb',
    ssl: { rejectUnauthorized: false }
  });

  // Lấy amenities_json hiện tại
  const [hRows] = await connection.query('SELECT amenities_json FROM homestays WHERE id = 2');
  const currentAmenities = hRows[0].amenities_json || {};
  currentAmenities.property_images = allHighResUrls;
  currentAmenities.main_image_url = allHighResUrls[0];

  // Update homestay amenities_json với TOÀN BỘ 96 ảnh
  await connection.query(
    'UPDATE homestays SET amenities_json = ? WHERE id = 2',
    [JSON.stringify(currentAmenities)]
  );
  console.log(`Đã lưu trọn vẹn ${allHighResUrls.length} ảnh vào homestay.amenities_json.property_images!`);

  // Cập nhật room_images cho phòng 6 (Phòng Tiêu Chuẩn Giường Đôi) với 10 ảnh thật chuẩn Booking
  await connection.query('DELETE FROM room_images WHERE room_id = 6');
  for (let idx = 0; idx < roomPhotos10.length; idx++) {
    await connection.query(
      'INSERT INTO room_images (room_id, image_url, is_primary, sort_order) VALUES (?, ?, ?, ?)',
      [6, roomPhotos10[idx], idx === 0 ? 1 : 0, idx]
    );
  }
  console.log(`Đã cập nhật ${roomPhotos10.length} ảnh thật vào bảng room_images của phòng ID 6!`);

  // Kiểm tra lại
  const [checkH] = await connection.query('SELECT amenities_json FROM homestays WHERE id = 2');
  console.log('Xác nhận: Số ảnh homestay trong DB hiện tại =', checkH[0].amenities_json.property_images.length);

  await connection.end();
}

syncAllRealPhotos();
