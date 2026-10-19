const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';

async function inspectHotel() {
  const ep = '/api/v1/hotels/getHotelDetails?hotel_id=11388160&arrival_date=2026-11-01&departure_date=2026-11-02&adults=2&room_qty=1&units=metric&temperature_unit=c&languagecode=vi&currency_code=VND';
  const res = await fetch(`https://${host}${ep}`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const json = await res.json();
  const d = json.data;

  console.log('--- FACILITIES BLOCK ---');
  console.log(JSON.stringify(d.facilities_block, null, 2));

  console.log('--- TOP UFI BENEFITS ---');
  console.log(JSON.stringify(d.top_ufi_benefits, null, 2));

  console.log('--- ROOMS KEYS & COUNT ---');
  console.log('Rooms type:', typeof d.rooms, Array.isArray(d.rooms) ? d.rooms.length : Object.keys(d.rooms || {}));
  if (d.rooms) {
    const firstRoomKey = Object.keys(d.rooms)[0];
    console.log('First room:', JSON.stringify(d.rooms[firstRoomKey], null, 2).slice(0, 1000));
  }

  console.log('--- AGGREGATED DATA / REVIEWS ---');
  console.log('Aggregated data:', JSON.stringify(d.aggregated_data, null, 2));
}

inspectHotel();
