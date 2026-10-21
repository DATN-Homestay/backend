import mysql from 'mysql2/promise';

async function checkCarnival() {
  const connection = await mysql.createConnection({
    host: 'homestay-nam0072004-b252.h.aivencloud.com',
    port: 16896,
    user: 'avnadmin',
    password: 'AVNS_EULEhrA6URi3BdcqYhi',
    database: 'defaultdb',
    ssl: { rejectUnauthorized: false }
  });

  const [rows] = await connection.query('SELECT id, name, source_url FROM homestays WHERE id = ? OR name LIKE ?', [2, '%Carnival%']);
  console.log('Homestays:', rows);

  const [roomRows] = await connection.query('SELECT id, room_name, homestay_id FROM rooms WHERE homestay_id = 2');
  console.log('Rooms for homestay 2:', roomRows);

  const [images] = await connection.query('SELECT id, image_url FROM homestay_images WHERE homestay_id = 2');
  console.log('Homestay images count:', images.length);

  await connection.end();
}

checkCarnival();
