const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';
const hotelId = '11925801';

async function checkRoomPhotosDetails() {
  const detailUrl = `https://${host}/api/v1/hotels/getHotelDetails?hotel_id=${hotelId}&arrival_date=2026-11-01&departure_date=2026-11-02&adults=2&room_qty=1&units=metric&temperature_unit=c&languagecode=vi&currency_code=VND`;
  const res = await fetch(detailUrl, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const json = await res.json();
  const d = json?.data;
  const room = d?.rooms?.['1192580113'];

  console.log('Room photos count:', room?.photos?.length);
  for (const p of (room?.photos || [])) {
    console.log(p.photo_id, p.url_max1280 || p.url_original);
  }
}

checkRoomPhotosDetails();
