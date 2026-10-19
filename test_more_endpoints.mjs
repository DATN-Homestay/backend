const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';

const endpoints = [
  '/api/v1/hotels/getHotelReviewScores?hotel_id=11388160',
  '/api/v1/hotels/getHotelReviews?hotel_id=11388160&page_number=1&languagecode=vi',
  '/api/v1/hotels/getHotelPhotos?hotel_id=11388160',
  '/api/v1/hotels/getHotelFacilities?hotel_id=11388160&languagecode=vi',
];

async function checkMore() {
  for (const ep of endpoints) {
    try {
      const res = await fetch(`https://${host}${ep}`, {
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
      });
      console.log(`[${ep}] Status: ${res.status}`);
      if (res.status === 200) {
        const json = await res.json();
        console.log(`Data snippet:`, JSON.stringify(json.data || json, null, 2).slice(0, 500));
      }
    } catch (e) {
      console.error(e);
    }
  }
}

checkMore();
