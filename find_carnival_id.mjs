const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';

async function searchCarnivalVilla() {
  const url = `https://${host}/api/v1/hotels/searchDestination?query=Carnival%20Villa%20Da%20Lat`;
  const res = await fetch(url, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const json = await res.json();
  console.log('Search destination result:', JSON.stringify(json.data, null, 2));

  // Also search hotellist directly in Da Lat
  const listUrl = `https://${host}/api/v1/hotels/searchHotels?dest_id=-3714993&search_type=city&arrival_date=2026-11-01&departure_date=2026-11-02&adults=2&room_qty=1&page_number=1&units=metric&temperature_unit=c&languagecode=vi&currency_code=VND`;
  const listRes = await fetch(listUrl, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const listJson = await listRes.json();
  const hotels = listJson?.data?.hotels || [];
  console.log('Hotels found in Da Lat page 1:', hotels.length);
  for (const h of hotels) {
    if (h.property?.name?.toLowerCase().includes('carnival') || h.hotel_id === 11388160) {
      console.log('Found hotel:', h.hotel_id, h.property?.name);
    }
  }
}

searchCarnivalVilla();
