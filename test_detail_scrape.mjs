import puppeteer from 'puppeteer-core';

async function testDetailScrape() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--lang=vi-VN,vi',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi,en;q=0.9' });

    console.log('Navigating to Le House DaLat...');
    await page.goto('https://www.booking.com/hotel/vn/le-house-dalat-thanh-pho-da-lat.vi.html', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await new Promise((r) => setTimeout(r, 4000));

    const detail = await page.evaluate(() => {
      // 1. Name & Address
      const name = document.querySelector('#hp_hotel_name, h2.d2fee873cb')?.textContent?.trim();
      const address = document.querySelector('[data-node_tt_id="location_score_tooltip"], span.hp_address_subtitle')?.textContent?.trim();

      // 2. Photos
      const photoEls = document.querySelectorAll('.bh-photo-grid-item img, .gallery-side-reviews-wrapper img, [data-preview-image-layout] img, .slick-slide img');
      const photos = [];
      photoEls.forEach((img) => {
        const src = img.src || img.getAttribute('data-highres');
        if (src && src.includes('bstatic.com') && !photos.includes(src)) {
          // Lấy ảnh độ phân giải cao
          const highRes = src.replace(/square\d+/, 'square1024').replace(/max\d+/, 'max1024x768');
          photos.push(highRes);
        }
      });

      // 3. Review scores breakdown
      const scoreRows = document.querySelectorAll('[data-testid="subscore-card"], .c-score-bar');
      const scores = {};
      scoreRows.forEach((row) => {
        const label = row.querySelector('.c-score-bar__title, [class*="label"], [class*="title"]')?.textContent?.trim();
        const val = row.querySelector('.c-score-bar__score, [class*="score"]')?.textContent?.trim();
        if (label && val) {
          scores[label] = parseFloat(val.replace(',', '.')) || val;
        }
      });

      // 4. Popular facilities
      const popEls = document.querySelectorAll('[data-testid="property-most-popular-facilities-wrapper"] [data-testid="facility-group-icon-and-title"], .hp_desc_important_facilities .important_facility');
      const popularFacilities = [];
      popEls.forEach((el) => {
        const t = el.textContent?.trim();
        if (t && !popularFacilities.includes(t)) popularFacilities.push(t);
      });

      // 5. Grouped facilities
      const groupBlocks = document.querySelectorAll('[data-testid="facility-group-container"], .hotel-facilities-group');
      const groupedFacilities = {};
      groupBlocks.forEach((block) => {
        const groupTitle = block.querySelector('[data-testid="facility-group-title"], .hotel-facilities-group__title')?.textContent?.trim();
        if (groupTitle) {
          const items = [];
          block.querySelectorAll('[data-testid="facility-item"], li').forEach((li) => {
            const itText = li.textContent?.trim();
            if (itText && !items.includes(itText)) items.push(itText);
          });
          if (items.length > 0) groupedFacilities[groupTitle] = items;
        }
      });

      // 6. Rooms from room table
      const roomRows = document.querySelectorAll('[data-testid="room-name"], tr.js-rt-block-row');
      const rooms = [];
      roomRows.forEach((r) => {
        const roomTitle = r.querySelector('[data-testid="room-name"], .rt-room-info .rt-room-title')?.textContent?.trim();
        if (roomTitle && !rooms.some((x) => x.name === roomTitle)) {
          rooms.push({ name: roomTitle });
        }
      });

      return {
        name,
        address,
        photosCount: photos.length,
        photos: photos.slice(0, 5),
        scores,
        popularFacilities,
        groupedFacilitiesKeys: Object.keys(groupedFacilities),
        groupedFacilities,
        rooms,
      };
    });

    console.log('Scraped Detail Data:');
    console.log('Name:', detail.name);
    console.log('Address:', detail.address);
    console.log('Photos Count:', detail.photosCount);
    console.log('Sample Photos:', detail.photos);
    console.log('Scores:', detail.scores);
    console.log('Popular Facilities:', detail.popularFacilities);
    console.log('Facility Groups:', detail.groupedFacilitiesKeys);
    console.log('Grouped Facilities Snippet:', JSON.stringify(detail.groupedFacilities, null, 2).slice(0, 500));
    console.log('Rooms:', detail.rooms);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

testDetailScrape();
