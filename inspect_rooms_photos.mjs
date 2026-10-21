const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';
const hotelId = '11388160';

async function inspectRoomsAndPhotos() {
  const url = `https://${host}/api/v1/hotels/getHotelDetails?hotel_id=${hotelId}&arrival_date=2026-11-01&departure_date=2026-11-02&adults=2&room_qty=1&units=metric&temperature_unit=c&languagecode=vi&currency_code=VND`;
  const res = await fetch(url, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const json = await res.json();
  const d = json.data;

  console.log('Hotel Name:', d?.hotel_name);
  console.log('Hotel All Rooms Count in d.rooms:', Object.keys(d?.rooms || {}).length);
  for (const [rId, room] of Object.entries(d?.rooms || {})) {
    console.log(`\n--- Room ID: ${rId} ---`);
    console.log('Room Name/Description:', room?.description || room?.room_name);
    console.log('Bed config:', JSON.stringify(room?.bed_configurations));
    console.log('Photos count:', room?.photos?.length);
    if (room?.photos?.length > 0) {
      console.log('Sample Photo URLs:', room.photos.slice(0, 3).map(p => p.url_max1280 || p.url_original || p.url_max750));
    }
  }

  // Also check block array if exists
  if (Array.isArray(d?.block)) {
    console.log('\n--- BLOCKS COUNT:', d.block.length);
    for (const b of d.block) {
      console.log(`Block room_id: ${b.room_id}, name: ${b.name || b.room_name}, min_price: ${b.min_price?.price || b.gross_amount?.value}`);
    }
  }
}

inspectRoomsAndPhotos();
