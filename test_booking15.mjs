const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';

async function testBookingCom15() {
  const endpoints = [
    '/api/v1/hotels/searchHotels?dest_id=-3712045&search_type=city&arrival_date=2026-11-01&departure_date=2026-11-02&adults=2&room_qty=1&page_number=1&units=metric&temperature_unit=c&languagecode=vi&currency_code=VND',
    '/api/v1/hotels/getHotelDetails?hotel_id=11388160&arrival_date=2026-11-01&departure_date=2026-11-02&adults=2&room_qty=1&units=metric&temperature_unit=c&languagecode=vi&currency_code=VND',
  ];

  for (const ep of endpoints) {
    try {
      console.log(`Testing: ${ep}`);
      const res = await fetch(`https://${host}${ep}`, {
        headers: {
          'X-RapidAPI-Key': key,
          'X-RapidAPI-Host': host,
        }
      });
      console.log(`Status: ${res.status}`);
      const data = await res.json();
      console.log(`Response keys:`, Object.keys(data));
      if (data.data) {
        if (Array.isArray(data.data)) {
          console.log(`Data length: ${data.data.length}`);
          console.log(`Item 0:`, JSON.stringify(data.data[0], null, 2).slice(0, 500));
        } else if (data.data.hotels) {
          console.log(`Hotels length: ${data.data.hotels.length}`);
          console.log(`Hotel 0:`, JSON.stringify(data.data.hotels[0], null, 2).slice(0, 1000));
        } else {
          console.log(`Data keys:`, Object.keys(data.data));
          console.log(`Data snippet:`, JSON.stringify(data.data, null, 2).slice(0, 1000));
        }
      } else {
        console.log(`Full response:`, JSON.stringify(data).slice(0, 500));
      }
    } catch (e) {
      console.error('Error:', e);
    }
  }
}

testBookingCom15();
