import puppeteer from 'puppeteer-core';

async function testFacilities() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.goto('https://www.booking.com/hotel/vn/le-house-dalat-thanh-pho-da-lat.vi.html', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await new Promise((r) => setTimeout(r, 3500));

    const facilitiesData = await page.evaluate(() => {
      const groups = [];
      // Look for facility groups
      document.querySelectorAll('.hotel-facilities-group, [data-testid="facility-group"], .bui-spacer--large').forEach((groupEl) => {
        const titleEl = groupEl.querySelector('.hotel-facilities-group__title, [data-testid="facility-group-title"], h5, h4');
        if (titleEl) {
          const groupTitle = titleEl.textContent?.trim();
          const items = [];
          groupEl.querySelectorAll('li, .bui-list__item, [data-testid="facility-item"]').forEach((itemEl) => {
            const itemText = itemEl.textContent?.trim();
            if (itemText && itemText.length > 1 && itemText !== groupTitle && !items.includes(itemText)) {
              items.push(itemText);
            }
          });
          if (groupTitle && items.length > 0) {
            groups.push({ category: groupTitle, items });
          }
        }
      });
      return groups;
    });

    console.log('Grouped facilities count:', facilitiesData.length);
    console.log(JSON.stringify(facilitiesData.slice(0, 10), null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

testFacilities();
