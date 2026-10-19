import mysql from 'mysql2/promise';

async function checkHomestay2Db() {
  const connection = await mysql.createConnection({
    host: 'homestay-nam0072004-b252.h.aivencloud.com',
    port: 16896,
    user: 'avnadmin',
    password: 'AVNS_EULEhrA6URi3BdcqYhi',
    database: 'defaultdb',
    ssl: { rejectUnauthorized: false }
  });

  const [rows] = await connection.query('SELECT id, name, amenities_json FROM homestays WHERE id = 2');
  const h = rows[0];
  console.log('Homestay 2 Name:', h.name);
  console.log('Property images in amenities_json:', h.amenities_json?.property_images?.length);
  if (h.amenities_json?.property_images) {
    console.log('Sample 3 property_images:', h.amenities_json.property_images.slice(0, 3));
  }

  const [roomImgRows] = await connection.query(
    'SELECT room_id, COUNT(*) as count FROM room_images WHERE room_id IN (SELECT id FROM rooms WHERE homestay_id = 2) GROUP BY room_id'
  );
  console.log('Room images count per room:', roomImgRows);

  await connection.end();
}

checkHomestay2Db();
