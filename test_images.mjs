import puppeteer from 'puppeteer-core';

async function checkImages() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.goto('https://www.booking.com/hotel/vn/le-house-dalat-thanh-pho-da-lat.vi.html', { waitUntil: 'domcontentloaded' });
    
    // Đợi 5s cho trang load xong hẳn
    await new Promise((r) => setTimeout(r, 5000));

    const result = await page.evaluate(() => {
      const allImgs = Array.from(document.querySelectorAll('img'));
      const hotelImgs = allImgs
        .map(img => img.src || img.getAttribute('data-highres'))
        .filter(src => src && src.includes('bstatic.com/xdata/images/hotel'));

      // Tiện nghi
      const facEls = Array.from(document.querySelectorAll('[data-testid="property-section--facilities"] [data-testid="facility-group-container"], .hotel-facilities__group, [data-testid="facility-group-icon-and-title"]'));
      const facilities = facEls.map(el => el.textContent?.trim()).filter(Boolean);

      // Điểm số
      const scoreBars = Array.from(document.querySelectorAll('[data-testid="subscore-card"], .c-score-bar, [data-testid="review-subscore"]'));
      const scores = scoreBars.map(el => el.textContent?.trim()).filter(Boolean);

      return {
        hotelImagesCount: hotelImgs.length,
        hotelImages: hotelImgs.slice(0, 5),
        facilitiesCount: facilities.length,
        facilitiesSnippet: facilities.slice(0, 10),
        scores,
      };
    });

    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

checkImages();
