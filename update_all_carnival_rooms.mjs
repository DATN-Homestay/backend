import mysql from 'mysql2/promise';

async function updateCarnivalRoomsRealPhotos() {
  const connection = await mysql.createConnection({
    host: 'homestay-nam0072004-b252.h.aivencloud.com',
    port: 16896,
    user: 'avnadmin',
    password: 'AVNS_EULEhrA6URi3BdcqYhi',
    database: 'defaultdb',
    ssl: { rejectUnauthorized: false }
  });

  // Lấy 96 ảnh thật từ amenities_json
  const [hRows] = await connection.query('SELECT amenities_json FROM homestays WHERE id = 2');
  const all96Photos = hRows[0].amenities_json?.property_images || [];
  console.log(`Tổng số ảnh thật có sẵn của Carnival Villa: ${all96Photos.length}`);

  // Lấy danh sách các phòng
  const [rooms] = await connection.query('SELECT id, room_name FROM rooms WHERE homestay_id = 2 ORDER BY id ASC');
  console.log(`Tổng số phòng cần cập nhật: ${rooms.length}`);

  // 10 ảnh thật 100% của phòng 6 từ d.rooms['1192580113']
  const room6Photos = [
    'https://cf.bstatic.com/xdata/images/hotel/1280x900/578147610.jpg?k=4071638d99545a50bf4759208a73d9deddea6cc791f5023c56a69d3dd96f6c3e&o=',
    'https://cf.bstatic.com/xdata/images/hotel/1280x900/578147624.jpg?k=f51460dfca4e282a1caf0f5a4b9e9aef16443bf49f8d31d3f8f48c4bb5818984&o=',
    'https://cf.bstatic.com/xdata/images/hotel/1280x900/578147619.jpg?k=bf15962e11011fbdaa9ec07d44dd02617a089d62b5ee2a7d10f976fe5919066f&o=',
    'https://cf.bstatic.com/xdata/images/hotel/1280x900/578147622.jpg?k=64d1895acb0cc119e431b14c6726438f837d5f9263423efe2033639ee5506015&o=',
    'https://cf.bstatic.com/xdata/images/hotel/1280x900/548740537.jpg?k=f3ffd737c463978f5fbe7ce9c0ade084dfe61510b37aeeaf49f10b6843907e68&o=',
    'https://cf.bstatic.com/xdata/images/hotel/1280x900/548740542.jpg?k=646a97badea051392502df34a8418db979f791c8e2d53567a0ae7463bb1f738c&o=',
    'https://cf.bstatic.com/xdata/images/hotel/1280x900/548740543.jpg?k=664274336824195c26ddbd608c0b3e56bda46c56a4eab4ac4a561da7b6d2f178&o=',
    'https://cf.bstatic.com/xdata/images/hotel/1280x900/548740550.jpg?k=739dee42ba8fcdc4d99e68b689c569328fca13b9d3ef7dac4579746779e11c52&o=',
    'https://cf.bstatic.com/xdata/images/hotel/1280x900/548740551.jpg?k=029a5126bb1d3f85daa33c8948058202a4470a43c2f20e5651f5a9e8104b02dd&o=',
    'https://cf.bstatic.com/xdata/images/hotel/1280x900/548751783.jpg?k=44336ffecf09cd095723c045780d1f4baf1cb670d4601847e18a9aa113eba2d1&o='
  ];

  for (let idx = 0; idx < rooms.length; idx++) {
    const room = rooms[idx];
    let photosToInsert = [];

    if (room.id === 6 || idx === 0) {
      photosToInsert = room6Photos;
    } else {
      // Phân bổ 10 ảnh thật khác nhau từ album 96 ảnh của Carnival Villa
      const start = (idx * 10) % all96Photos.length;
      for (let i = 0; i < 10; i++) {
        photosToInsert.push(all96Photos[(start + i) % all96Photos.length]);
      }
    }

    // Xóa và chèn lại 10 ảnh thật
    await connection.query('DELETE FROM room_images WHERE room_id = ?', [room.id]);
    for (let pIdx = 0; pIdx < photosToInsert.length; pIdx++) {
      await connection.query(
        'INSERT INTO room_images (room_id, image_url, is_primary, sort_order) VALUES (?, ?, ?, ?)',
        [room.id, photosToInsert[pIdx], pIdx === 0 ? 1 : 0, pIdx]
      );
    }

    console.log(`Phòng ${room.id} (${room.room_name}): Đã cập nhật ${photosToInsert.length} ảnh thật!`);
  }

  const [countRows] = await connection.query(
    'SELECT room_id, COUNT(*) as count FROM room_images WHERE room_id IN (SELECT id FROM rooms WHERE homestay_id = 2) GROUP BY room_id'
  );
  console.log('Tổng kết số lượng ảnh thật của các phòng:', countRows);

  await connection.end();
}

updateCarnivalRoomsRealPhotos();
