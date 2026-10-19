const key = '81861be6f7msh7481ec3ba483b1fp120e58jsnc05697d9a238';
const host = 'apidojo-booking-v1.p.rapidapi.com';

async function testEndpoints() {
  console.log('1. Test properties/list...');
  try {
    const res = await fetch(`https://${host}/properties/list?offset=0&page_number=1&arrival_date=2026-11-01&departure_date=2026-11-02&guest_qty=2&dest_ids=-3712045&room_qty=1&search_type=city&currency_code=VND&locale=vi`, {
      headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': host }
    });
    console.log('properties/list status:', res.status);
    const data = await res.json();
    const list = data?.result || data?.data || [];
    console.log('Hotels found:', list.length);
    if (list.length > 0) {
      const h0 = list[0];
      const hotelId = h0.hotel_id;
      console.log('Sample hotel ID:', hotelId, h0.hotel_name || h0.name);

      // 2. Test get-hotel-photos
      console.log('\n2. Test properties/get-hotel-photos...');
      const resPhotos = await fetch(`https://${host}/properties/get-hotel-photos?hotel_id=${hotelId}`, {
        headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': host }
      });
      console.log('get-hotel-photos status:', resPhotos.status);
      if (resPhotos.ok) {
        const photos = await resPhotos.json();
        console.log('Photos response:', Array.isArray(photos) ? photos.length : Object.keys(photos));
      }

      // 3. Test get-facilities
      console.log('\n3. Test properties/get-facilities...');
      const resFac = await fetch(`https://${host}/properties/get-facilities?hotel_id=${hotelId}&locale=vi`, {
        headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': host }
      });
      console.log('get-facilities status:', resFac.status);
      if (resFac.ok) {
        const facs = await resFac.json();
        console.log('Facilities response:', Array.isArray(facs) ? facs.length : Object.keys(facs));
      }

      // 4. Test v2/get-rooms
      console.log('\n4. Test properties/v2/get-rooms...');
      const resRooms = await fetch(`https://${host}/properties/v2/get-rooms?hotel_id=${hotelId}&arrival_date=2026-11-01&departure_date=2026-11-02&rec_guest_qty=2&rec_room_qty=1&currency_code=VND&locale=vi`, {
        headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': host }
      });
      console.log('v2/get-rooms status:', resRooms.status);
      if (resRooms.ok) {
        const roomsData = await resRooms.json();
        const info = Array.isArray(roomsData) ? roomsData[0] : roomsData;
        console.log('v2/get-rooms blocks count:', info?.block?.length, 'rooms count:', Object.keys(info?.rooms || {}).length);
      }
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
}

testEndpoints();
