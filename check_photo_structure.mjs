const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';
const hotelId = '11925801';

async function checkPhotoStructure() {
  const photosUrl = `https://${host}/api/v1/hotels/getHotelPhotos?hotel_id=${hotelId}`;
  const res = await fetch(photosUrl, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const json = await res.json();
  const photos = json.data;

  console.log('Total photos count:', photos.length);
  for (let i = 0; i < Math.min(10, photos.length); i++) {
    console.log(`Photo ${i}:`, JSON.stringify(photos[i]));
  }
}

checkPhotoStructure();
