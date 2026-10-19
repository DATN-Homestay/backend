const key = '81861be6f7msh7481ec3ba483b1fp120e58jsnc05697d9a238';

async function testNewKey() {
  console.log('--- TEST KEY MỚI VỚI apidojo-booking-v1.p.rapidapi.com ---');
  try {
    const res1 = await fetch('https://apidojo-booking-v1.p.rapidapi.com/locations/auto-complete?text=Da%20Lat&languagecode=vi', {
      headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': 'apidojo-booking-v1.p.rapidapi.com' }
    });
    console.log('apidojo auto-complete status:', res1.status);
    const data1 = await res1.json();
    console.log('apidojo response length / keys:', Array.isArray(data1) ? data1.length : Object.keys(data1));
  } catch (e) {
    console.log('apidojo error:', e.message);
  }

  console.log('\n--- TEST KEY MỚI VỚI booking-com15.p.rapidapi.com ---');
  try {
    const res2 = await fetch('https://booking-com15.p.rapidapi.com/api/v1/hotels/searchDestination?query=Da%20Lat', {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'booking-com15.p.rapidapi.com' }
    });
    console.log('booking-com15 searchDestination status:', res2.status);
    const data2 = await res2.json();
    console.log('booking-com15 response keys:', Object.keys(data2));
  } catch (e) {
    console.log('booking-com15 error:', e.message);
  }
}

testNewKey();
