import mysql from 'mysql2/promise';

const roomPhotos10 = [
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

async function updateRoom6Photos() {
  const connection = await mysql.createConnection({
    host: 'homestay-nam0072004-b252.h.aivencloud.com',
    port: 16896,
    user: 'avnadmin',
    password: 'AVNS_EULEhrA6URi3BdcqYhi',
    database: 'defaultdb',
    ssl: { rejectUnauthorized: false }
  });

  await connection.query('DELETE FROM room_images WHERE room_id = 6');
  for (let idx = 0; idx < roomPhotos10.length; idx++) {
    await connection.query(
      'INSERT INTO room_images (room_id, image_url, is_primary, sort_order) VALUES (?, ?, ?, ?)',
      [6, roomPhotos10[idx], idx === 0 ? 1 : 0, idx]
    );
  }

  const [rows] = await connection.query('SELECT COUNT(*) as cnt FROM room_images WHERE room_id = 6');
  console.log('Room 6 photos updated successfully! Total:', rows[0].cnt);

  await connection.end();
}

updateRoom6Photos();
