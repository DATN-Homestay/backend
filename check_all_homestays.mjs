import mysql from 'mysql2/promise';

async function checkAllHomestays() {
  const connection = await mysql.createConnection({
    host: 'homestay-nam0072004-b252.h.aivencloud.com',
    port: 16896,
    user: 'avnadmin',
    password: 'AVNS_EULEhrA6URi3BdcqYhi',
    database: 'defaultdb',
    ssl: { rejectUnauthorized: false }
  });

  const [homestays] = await connection.query('SELECT id, name, city, source_url, amenities_json FROM homestays ORDER BY id ASC');
  console.log(`=== TỔNG CỘNG CÓ ${homestays.length} HOMESTAY TRONG DATABASE ===\n`);

  for (const h of homestays) {
    const [rooms] = await connection.query('SELECT id, room_name, area_sqm, bed_info, room_details_json FROM rooms WHERE homestay_id = ?', [h.id]);
    const [roomImgs] = await connection.query('SELECT COUNT(*) as cnt FROM room_images WHERE room_id IN (SELECT id FROM rooms WHERE homestay_id = ?)', [h.id]);
    
    const propImgsCount = h.amenities_json?.property_images?.length || 0;
    const hasGroupedFac = h.amenities_json?.grouped_facilities ? Object.keys(h.amenities_json.grouped_facilities).length : 0;
    const hasDetailedRooms = rooms.some(r => r.room_details_json !== null);

    console.log(`ID [${h.id}] - ${h.name} (${h.city})`);
    console.log(`  Source URL: ${h.source_url}`);
    console.log(`  Ảnh homestay trong amenities_json: ${propImgsCount} ảnh`);
    console.log(`  Tiện nghi phân nhóm (Grouped Facilities): ${hasGroupedFac} nhóm`);
    console.log(`  Số phòng: ${rooms.length} phòng | Tổng ảnh phòng: ${roomImgs[0].cnt} ảnh`);
    console.log(`  Đã có chi tiết phòng (room_details_json): ${hasDetailedRooms ? 'CÓ' : 'CHƯA'}`);
    console.log('--------------------------------------------------');
  }

  await connection.end();
}

checkAllHomestays();
