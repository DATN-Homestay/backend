const key = '27760738a9msh3da596e3ac49627p1d9748jsn4a7304055238';

const hosts = [
  { host: 'booking-com15.p.rapidapi.com', endpoint: '/api/v1/hotels/searchDestination?query=Da%20Lat' },
  { host: 'booking-com.p.rapidapi.com', endpoint: '/v1/hotels/locations?name=Da%20Lat&locale=en-gb' },
  { host: 'booking8.p.rapidapi.com', endpoint: '/locations/auto-complete?text=Da%20Lat' },
  { host: 'booking-com13.p.rapidapi.com', endpoint: '/stays/auto-complete?query=Da%20Lat' },
  { host: 'apidojo-booking-v1.p.rapidapi.com', endpoint: '/properties/list?offset=0&arrival_date=2026-11-01&departure_date=2026-11-02&dest_id=-3712045&dest_type=city' },
];

async function check() {
  for (const h of hosts) {
    try {
      const res = await fetch(`https://${h.host}${h.endpoint}`, {
        headers: {
          'X-RapidAPI-Key': key,
          'X-RapidAPI-Host': h.host,
        }
      });
      const data = await res.json().catch(() => null);
      console.log(`[${h.host}] Status: ${res.status}`, data ? JSON.stringify(data).slice(0, 150) : 'No JSON');
    } catch (e) {
      console.log(`[${h.host}] Error:`, e.message);
    }
  }
}

check();
