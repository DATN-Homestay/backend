import puppeteer from 'puppeteer-core';

async function checkFacilitiesScroll() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.goto('https://www.booking.com/hotel/vn/le-house-dalat-thanh-pho-da-lat.vi.html', { waitUntil: 'domcontentloaded' });
    
    // Scroll down to middle of page to trigger lazy loading
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="property-facilities-block-container"]') || document.querySelector('#hp_facilities_box');
      if (el) el.scrollIntoView();
      else window.scrollTo(0, document.body.scrollHeight * 0.7);
    });

    await new Promise((r) => setTimeout(r, 3000));

    const facDetail = await page.evaluate(() => {
      // Tìm tất cả các khối tiện nghi sau khi scroll
      const container = document.querySelector('#hp_facilities_box, [data-testid="property-section--facilities"], [data-testid="property-facilities-block-container"]');
      const text = container?.innerText || '';
      return {
        foundContainer: !!container,
        containerTextSnippet: text.slice(0, 800),
      };
    });

    console.log('Scroll Result:', JSON.stringify(facDetail, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

checkFacilitiesScroll();
