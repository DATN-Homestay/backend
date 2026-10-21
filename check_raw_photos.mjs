const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';
const hotelId = '11925801';

async function checkRawPhotosResponse() {
  const url = `https://${host}/api/v1/hotels/getHotelPhotos?hotel_id=${hotelId}`;
  const res = await fetch(url, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const json = await res.json();
  console.log('Keys in json:', Object.keys(json));
  if (json.data && json.data.length > 0) {
    console.log('Sample photo keys:', Object.keys(json.data[0]));
    console.log('Sample 3 items:', JSON.stringify(json.data.slice(0, 3), null, 2));
  }
}

checkRawPhotosResponse();
