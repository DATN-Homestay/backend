import puppeteer from 'puppeteer-core';

async function testRoomsTable() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const url = 'https://www.booking.com/hotel/vn/le-house-dalat-thanh-pho-da-lat.vi.html?checkin=2026-11-01&checkout=2026-11-02&group_adults=2&no_rooms=1';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 5000));

    const rooms = await page.evaluate(() => {
      // Tìm các tên phòng trong bảng phòng
      const list = [];
      const links = document.querySelectorAll('a.hprt-roomtype-link, [data-testid="room-name"], .rt-room-title, a[href*="#room_"]');
      links.forEach(l => {
        const name = l.textContent?.trim();
        if (name && name.length > 2 && !list.includes(name)) list.push(name);
      });

      // Giá phòng
      const prices = [];
      document.querySelectorAll('.prco-valign-middle-helper, [data-testid="price-and-discounted-price"]').forEach(p => {
        const text = p.textContent?.trim();
        if (text && !prices.includes(text)) prices.push(text);
      });

      return {
        roomsCount: list.length,
        rooms: list,
        pricesCount: prices.length,
        prices: prices.slice(0, 5),
      };
    });

    console.log('Rooms Result:', JSON.stringify(rooms, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

testRoomsTable();
