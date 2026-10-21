import puppeteer from 'puppeteer-core';

async function checkFacilitiesSelector() {
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

    const facData = await page.evaluate(() => {
      // Tìm element chứa chữ "Các tiện nghi của" hoặc "Tiện nghi"
      const allHeadings = Array.from(document.querySelectorAll('h2, h3, h4, div'));
      const facHeading = allHeadings.find(h => h.textContent && h.textContent.includes('Các tiện nghi của'));
      
      let containerText = '';
      let parentHTML = '';
      if (facHeading) {
        let parent = facHeading.parentElement;
        while (parent && !parent.classList.contains('hp-section') && parent.tagName !== 'BODY') {
          if (parent.querySelectorAll('div').length > 10) break;
          parent = parent.parentElement;
        }
        containerText = parent?.innerText?.slice(0, 1500) || '';
      }

      // Check all elements with data-testid containing "facility"
      const testIds = Array.from(document.querySelectorAll('[data-testid]'))
        .map(el => el.getAttribute('data-testid'))
        .filter(id => id && id.toLowerCase().includes('facil'));

      return {
        hasFacHeading: !!facHeading,
        containerText,
        testIds: Array.from(new Set(testIds)),
      };
    });

    console.log('Facility Data:', JSON.stringify(facData, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

checkFacilitiesSelector();
