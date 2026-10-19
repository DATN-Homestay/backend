import puppeteer from 'puppeteer-core';

async function checkPageScripts() {
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

    const jsonLd = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      const data = [];
      scripts.forEach(s => {
        try { data.push(JSON.parse(s.textContent)); } catch(e) {}
      });
      return data;
    });

    console.log('JSON-LD count:', jsonLd.length);
    for (let i = 0; i < jsonLd.length; i++) {
      console.log(`JSON-LD ${i}:`, JSON.stringify(jsonLd[i], null, 2).slice(0, 1000));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

checkPageScripts();
