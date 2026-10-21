const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';

async function checkHeaders() {
  const ep = '/api/v1/hotels/searchDestination?query=Da%20Lat';
  const res = await fetch(`https://${host}${ep}`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  console.log('Status:', res.status);
  for (const [k, v] of res.headers.entries()) {
    if (k.toLowerCase().includes('ratelimit') || k.toLowerCase().includes('rapidapi')) {
      console.log(`${k}: ${v}`);
    }
  }
}

checkHeaders();
