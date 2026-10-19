async function test() {
  try {
    const res = await fetch('https://www.booking.com/searchresults.vi.html?ss=%C4%90%C3%A0+L%E1%BA%A1t&checkin=2026-11-01&checkout=2026-11-02&group_adults=2&no_rooms=1', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      }
    });
    console.log('Status:', res.status);
    const html = await res.text();
    console.log('HTML Length:', html.length);
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    console.log('Title:', titleMatch ? titleMatch[1] : 'None');
    console.log('Contains property-card:', html.includes('data-testid="property-card"'));
  } catch (err) {
    console.error('Error:', err);
  }
}
test();
