const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';
const host = 'booking-com15.p.rapidapi.com';

async function checkFacilities() {
  const ep = '/api/v1/hotels/getHotelFacilities?hotel_id=11388160&languagecode=vi';
  const res = await fetch(`https://${host}${ep}`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  });
  const json = await res.json();
  const d = json.data;
  console.log('Facilities count:', d?.facilities?.length);
  if (d?.facilities) {
    const list = d.facilities.map(f => {
      const inst = f.instances?.map(i => i.title).join(', ');
      return { id: f.id, groupId: f.groupId, titles: inst };
    });
    console.log(JSON.stringify(list.slice(0, 30), null, 2));
  }
}

checkFacilities();
