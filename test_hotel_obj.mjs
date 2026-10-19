import puppeteer from 'puppeteer-core';

async function checkHotelVar() {
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

    const hotelObj = await page.evaluate(() => {
      return {
        keys: window.booking?.hotel ? Object.keys(window.booking.hotel) : [],
        name: window.booking?.hotel?.name,
        address: window.booking?.hotel?.address,
        latitude: window.booking?.hotel?.latitude,
        longitude: window.booking?.hotel?.longitude,
        reviewScore: window.booking?.hotel?.review_score,
        reviewsCount: window.booking?.hotel?.reviews_count,
        hotelId: window.booking?.env?.b_hotel_id,
        photos: window.booking?.hotel?.photos,
        rooms: window.booking?.hotel?.rooms,
      };
    });

    console.log('booking.hotel:', JSON.stringify(hotelObj, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

checkHotelVar();
