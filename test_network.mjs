import puppeteer from 'puppeteer-core';

async function monitorNetwork() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const apis = [];
    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('graphql') || url.includes('/api/') || url.includes('review') || url.includes('facilit') || url.includes('hotel')) {
        try {
          const contentType = res.headers()['content-type'] || '';
          if (contentType.includes('json')) {
            const data = await res.json().catch(() => null);
            if (data) {
              apis.push({ url: url.slice(0, 150), keys: Object.keys(data) });
            }
          }
        } catch (e) {}
      }
    });

    await page.goto('https://www.booking.com/hotel/vn/le-house-dalat-thanh-pho-da-lat.vi.html', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 6000));

    console.log(`Intercepted ${apis.length} JSON API responses:`);
    apis.forEach((a, i) => console.log(`${i}: ${a.url} -> [${a.keys.join(', ')}]`));
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

monitorNetwork();
