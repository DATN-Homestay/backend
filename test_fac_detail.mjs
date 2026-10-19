import puppeteer from 'puppeteer-core';

async function checkFacilitiesContent() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.goto('https://www.booking.com/hotel/vn/le-house-dalat-thanh-pho-da-lat.vi.html', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 4000));

    const facDetail = await page.evaluate(() => {
      // 1. Popular facilities
      const popWrapper = document.querySelector('[data-testid="property-most-popular-facilities-wrapper"]');
      const popular = [];
      if (popWrapper) {
        popWrapper.querySelectorAll('li, div, span').forEach(el => {
          const t = el.textContent?.trim();
          if (t && t.length > 2 && t.length < 50 && !popular.includes(t)) popular.push(t);
        });
      }

      // 2. Full facilities block
      const blockContainer = document.querySelector('[data-testid="property-facilities-block-container"]');
      const grouped = {};
      if (blockContainer) {
        // Mỗi group thường có heading và danh sách ul/li
        const groups = blockContainer.querySelectorAll('.hotel-facilities-group, [class*="facility-group"], :scope > div');
        groups.forEach(g => {
          const title = g.querySelector('h3, h4, [class*="title"], [class*="header"]')?.textContent?.trim();
          if (title) {
            const items = [];
            g.querySelectorAll('li, [class*="item"]').forEach(it => {
              const text = it.textContent?.trim();
              if (text && text.length > 1 && !items.includes(text)) items.push(text);
            });
            if (items.length > 0) grouped[title] = items;
          }
        });
      }

      return {
        popular: popular.slice(0, 10),
        groupedKeys: Object.keys(grouped),
        grouped,
        blockRawText: blockContainer?.innerText?.slice(0, 1000),
      };
    });

    console.log('Facilities Detail:', JSON.stringify(facDetail, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

checkFacilitiesContent();
