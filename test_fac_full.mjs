import puppeteer from 'puppeteer-core';

async function checkFacilitiesFull() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.goto('https://www.booking.com/hotel/vn/le-house-dalat-thanh-pho-da-lat.vi.html', { waitUntil: 'domcontentloaded' });
    
    await page.evaluate(() => {
      const el = document.querySelector('#hp_facilities_box, [data-testid="property-section--facilities"]');
      if (el) el.scrollIntoView();
      else window.scrollTo(0, document.body.scrollHeight * 0.7);
    });

    await new Promise((r) => setTimeout(r, 4000));

    const facDetail = await page.evaluate(() => {
      const container = document.querySelector('#hp_facilities_box, [data-testid="property-section--facilities"]');
      return container ? container.innerText : 'None';
    });

    console.log('Full Facilities Text:\n', facDetail);
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

checkFacilitiesFull();
