const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';

async function checkFacKeys() {
  const ep = '/api/v1/hotels/getHotelFacilities?hotel_id=11388160&languagecode=vi';
  const res = await fetch(`https://${host}${ep}`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const json = await res.json();
  const d = json.data;
  console.log('Keys of data:', Object.keys(d));
  if (d.facilityGroups) {
    console.log('facilityGroups:', JSON.stringify(d.facilityGroups, null, 2));
  }
}

checkFacKeys();
