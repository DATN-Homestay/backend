import puppeteer from 'puppeteer-core';

async function inspectHotelPageByPageName() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('graphql')) {
        try {
          const json = await res.json();
          if (json.data?.hotelPageByPageName) {
            console.log('hotelPageByPageName keys:', Object.keys(json.data.hotelPageByPageName));
            console.log(JSON.stringify(json.data.hotelPageByPageName, null, 2).slice(0, 3000));
          }
        } catch (e) {}
      }
    });

    await page.goto('https://www.booking.com/hotel/vn/le-house-dalat-thanh-pho-da-lat.vi.html', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 6000));
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

inspectHotelPageByPageName();
