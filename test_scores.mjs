const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';

async function checkScores() {
  const ep = '/api/v1/hotels/getHotelReviewScores?hotel_id=11388160';
  const res = await fetch(`https://${host}${ep}`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

checkScores();
