import puppeteer from 'puppeteer-core';

async function testPuppeteer() {
  console.log('Launching Chrome...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--lang=vi-VN,vi',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi,en;q=0.9' });

    console.log('Navigating to Booking Da Lat...');
    await page.goto('https://www.booking.com/searchresults.vi.html?ss=%C4%90%C3%A0+L%E1%BA%A1t&checkin=2026-11-01&checkout=2026-11-02&group_adults=2&no_rooms=1', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Chờ 3s để các card xuất hiện
    await new Promise((r) => setTimeout(r, 3000));

    // Lấy danh sách property card
    const items = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid="property-card"]');
      const results = [];
      cards.forEach((card) => {
        const titleEl = card.querySelector('[data-testid="title"]');
        const linkEl = card.querySelector('a[data-testid="title-link"]');
        const priceEl = card.querySelector('[data-testid="price-and-discounted-price"]');
        const scoreEl = card.querySelector('[data-testid="review-score"]');
        const addressEl = card.querySelector('[data-testid="address"]');
        const imgEl = card.querySelector('img[data-testid="image"]');

        if (titleEl) {
          results.push({
            name: titleEl.textContent?.trim(),
            url: linkEl?.href?.split('?')[0],
            price: priceEl?.textContent?.trim(),
            scoreText: scoreEl?.textContent?.replace(/\s+/g, ' ')?.trim(),
            address: addressEl?.textContent?.trim(),
            image: imgEl?.src,
          });
        }
      });
      return results;
    });

    console.log(`Found ${items.length} real properties from Booking.com!`);
    console.log('Top 3 properties:', JSON.stringify(items.slice(0, 3), null, 2));
  } catch (err) {
    console.error('Puppeteer error:', err);
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

testPuppeteer();
