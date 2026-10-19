const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';

async function checkSearchHotels() {
  const ep = '/api/v1/hotels/searchHotels?dest_id=-3712045&search_type=city&arrival_date=2026-11-01&departure_date=2026-11-02&adults=2&room_qty=1&page_number=1&units=metric&temperature_unit=c&languagecode=vi&currency_code=VND';
  const res = await fetch(`https://${host}${ep}`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const json = await res.json();
  const hotels = json.data?.hotels || [];
  console.log('Total hotels returned in 1 call:', hotels.length);
  for (let i = 0; i < Math.min(5, hotels.length); i++) {
    const h = hotels[i];
    console.log(`\n--- Hotel ${i + 1} ---`);
    console.log('ID:', h.hotel_id);
    console.log('Name:', h.property?.name);
    console.log('Price:', h.property?.priceBreakdown?.grossPrice?.value);
    console.log('Review score:', h.property?.reviewScore);
    console.log('Review count:', h.property?.reviewCount);
    console.log('PhotoUrls:', h.property?.photoUrls?.slice(0, 3));
    console.log('Latitude/Longitude:', h.property?.latitude, h.property?.longitude);
    console.log('Checkin/Checkout:', h.property?.checkin, h.property?.checkoutDate);
  }
}

checkSearchHotels();
