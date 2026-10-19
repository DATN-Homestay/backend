const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const hotelId = '11388160';

async function testApiDojo() {
  console.log('=== TEST apidojo-booking-v1.p.rapidapi.com ===');
  const host = 'apidojo-booking-v1.p.rapidapi.com';
  
  // 1. properties/get-hotel-photos
  try {
    const url = `https://${host}/properties/get-hotel-photos?hotel_id=${hotelId}`;
    const res = await fetch(url, {
      headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': host }
    });
    console.log('get-hotel-photos status:', res.status);
    if (res.ok) {
      const data = await res.json();
      console.log('get-hotel-photos response type:', typeof data, Array.isArray(data) ? `Array length: ${data.length}` : Object.keys(data));
      if (Array.isArray(data) && data.length > 0) {
        console.log('Sample photo 0:', data[0]);
      } else if (data.data) {
        console.log('data.data:', Array.isArray(data.data) ? `length ${data.data.length}` : Object.keys(data.data));
      }
    } else {
      const text = await res.text();
      console.log('get-hotel-photos error:', text.slice(0, 200));
    }
  } catch (e) {
    console.log('get-hotel-photos exception:', e.message);
  }

  // 2. properties/v2/get-rooms
  try {
    const url = `https://${host}/properties/v2/get-rooms?hotel_id=${hotelId}&arrival_date=2026-11-01&departure_date=2026-11-02&rec_guest_qty=2&rec_room_qty=1&currency_code=VND&locale=vi`;
    const res = await fetch(url, {
      headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': host }
    });
    console.log('v2/get-rooms status:', res.status);
    if (res.ok) {
      const data = await res.json();
      const hotelInfo = Array.isArray(data) ? data[0] : data;
      console.log('v2/get-rooms rooms keys count:', Object.keys(hotelInfo?.rooms || {}).length);
      const firstRoomId = Object.keys(hotelInfo?.rooms || {})[0];
      if (firstRoomId) {
        const roomObj = hotelInfo.rooms[firstRoomId];
        console.log(`Room ${firstRoomId} photos count:`, roomObj.photos?.length);
        if (roomObj.photos?.length > 0) {
          console.log('Sample room photo:', roomObj.photos[0]);
        }
      }
    } else {
      const text = await res.text();
      console.log('v2/get-rooms error:', text.slice(0, 200));
    }
  } catch (e) {
    console.log('v2/get-rooms exception:', e.message);
  }
}

async function testBooking15() {
  console.log('\n=== TEST booking-com15.p.rapidapi.com ===');
  const host = 'booking-com15.p.rapidapi.com';

  // 1. getHotelPhotos
  try {
    const url = `https://${host}/api/v1/hotels/getHotelPhotos?hotel_id=${hotelId}`;
    const res = await fetch(url, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
    });
    console.log('getHotelPhotos status:', res.status);
    if (res.ok) {
      const data = await res.json();
      console.log('getHotelPhotos type:', typeof data, Array.isArray(data?.data) ? `Array length: ${data.data.length}` : Object.keys(data || {}));
      if (Array.isArray(data?.data) && data.data.length > 0) {
        console.log('Sample photo 0:', data.data[0]);
      }
    } else {
      const text = await res.text();
      console.log('getHotelPhotos error:', text.slice(0, 200));
    }
  } catch (e) {
    console.log('getHotelPhotos exception:', e.message);
  }

  // 2. getHotelDetails (rooms + photos)
  try {
    const url = `https://${host}/api/v1/hotels/getHotelDetails?hotel_id=${hotelId}&arrival_date=2026-11-01&departure_date=2026-11-02&adults=2&room_qty=1&units=metric&temperature_unit=c&languagecode=vi&currency_code=VND`;
    const res = await fetch(url, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
    });
    console.log('getHotelDetails status:', res.status);
    if (res.ok) {
      const json = await res.json();
      const d = json.data;
      console.log('Rooms in getHotelDetails:', typeof d?.rooms, Object.keys(d?.rooms || {}).length);
      const firstRoomKey = Object.keys(d?.rooms || {})[0];
      if (firstRoomKey) {
        const r = d.rooms[firstRoomKey];
        console.log(`Room [${firstRoomKey}] photos:`, r.photos?.length);
        if (r.photos?.length > 0) {
          console.log('Sample room photo:', r.photos[0]);
        }
      }
    }
  } catch (e) {
    console.log('getHotelDetails exception:', e.message);
  }
}

async function run() {
  await testApiDojo();
  await testBooking15();
}

run();
