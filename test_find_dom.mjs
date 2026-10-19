import puppeteer from 'puppeteer-core';

async function findGroupedInDOM() {
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

    const result = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('*'));
      const bathroomEl = allDivs.find(el => el.children.length === 0 && el.textContent?.trim() === 'Phòng tắm');
      if (!bathroomEl) return { found: false };
      
      let p = bathroomEl.parentElement;
      while (p && p.tagName !== 'BODY') {
        if (p.textContent.includes('Giấy vệ sinh') || p.textContent.includes('Khăn tắm')) {
          return {
            found: true,
            tagName: p.tagName,
            className: p.className,
            parentId: p.id,
            outerHTMLSnippet: p.outerHTML.slice(0, 800),
          };
        }
        p = p.parentElement;
      }
      return { found: true, parentFound: false };
    });

    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

findGroupedInDOM();
