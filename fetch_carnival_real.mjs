const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';
const hotelId = '11925801';

async function fetchCarnivalRealData() {
  console.log('=== LẤY TOÀN BỘ ẢNH THẬT CỦA CARNIVAL VILLA (ID: 11925801) ===');
  
  // 1. getHotelPhotos
  const photosUrl = `https://${host}/api/v1/hotels/getHotelPhotos?hotel_id=${hotelId}`;
  const resPhotos = await fetch(photosUrl, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const photosJson = await resPhotos.json();
  const allPhotos = photosJson?.data || [];
  console.log('Tổng số ảnh thật của Carnival Villa:', allPhotos.length);
  if (allPhotos.length > 0) {
    console.log('Ảnh đầu tiên:', allPhotos[0]);
    console.log('3 ảnh mẫu:', allPhotos.slice(0, 3).map(p => p.url));
  }

  // 2. getHotelDetails (rooms + photos riêng của từng room)
  const detailUrl = `https://${host}/api/v1/hotels/getHotelDetails?hotel_id=${hotelId}&arrival_date=2026-11-01&departure_date=2026-11-02&adults=2&room_qty=1&units=metric&temperature_unit=c&languagecode=vi&currency_code=VND`;
  const resDetail = await fetch(detailUrl, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const detailJson = await resDetail.json();
  const d = detailJson?.data;

  console.log('\nTên khách sạn:', d?.hotel_name);
  console.log('Số phòng trong d.rooms:', Object.keys(d?.rooms || {}).length);
  for (const [rId, room] of Object.entries(d?.rooms || {})) {
    console.log(`\nPhòng [${rId}]:`, room?.description || room?.room_name);
    console.log('Số ảnh riêng của phòng này:', room?.photos?.length);
    if (room?.photos?.length > 0) {
      console.log('Ảnh phòng mẫu:', room.photos.slice(0, 2).map(p => p.url_max1280 || p.url_original || p.url_max750));
    }
  }

  // 3. getHotelFacilities
  const facUrl = `https://${host}/api/v1/hotels/getHotelFacilities?hotel_id=${hotelId}`;
  const resFac = await fetch(facUrl, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const facJson = await resFac.json();
  console.log('\nSố nhóm tiện nghi (Facilities):', facJson?.data?.length);
}

fetchCarnivalRealData();
