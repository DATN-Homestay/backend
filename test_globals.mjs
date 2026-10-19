import puppeteer from 'puppeteer-core';

async function checkBookingGlobals() {
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

    const globalInfo = await page.evaluate(() => {
      return {
        hotelPhotos: window.booking?.env?.hotel_photos?.length || 0,
        b_rooms: window.b_rooms_available_and_soldout?.length || 0,
        hasBooking: typeof window.booking !== 'undefined',
        bookingKeys: window.booking ? Object.keys(window.booking) : [],
        envKeys: window.booking?.env ? Object.keys(window.booking.env) : [],
      };
    });

    console.log('Global Info:', globalInfo);
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

checkBookingGlobals();
