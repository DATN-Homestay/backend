const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';
const hotelId = '11925801';

async function testOtherDates() {
  const dates = [
    { in: '2026-11-15', out: '2026-11-16' },
    { in: '2026-12-01', out: '2026-12-02' },
    { in: '2026-10-25', out: '2026-10-26' },
    { in: '2026-11-20', out: '2026-11-21' }
  ];

  for (const d of dates) {
    const detailUrl = `https://${host}/api/v1/hotels/getHotelDetails?hotel_id=${hotelId}&arrival_date=${d.in}&departure_date=${d.out}&adults=2&room_qty=1&units=metric&temperature_unit=c&languagecode=vi&currency_code=VND`;
    const res = await fetch(detailUrl, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
    });
    const json = await res.json();
    const rooms = json?.data?.rooms || {};
    console.log(`Date ${d.in} -> ${d.out}: rooms count =`, Object.keys(rooms).length);
    for (const [rId, r] of Object.entries(rooms)) {
      console.log(`  Room ${rId}:`, r.description?.slice(0, 60), `photos: ${r.photos?.length}`);
    }
  }
}

testOtherDates();
