import puppeteer from 'puppeteer';

const VIEWPORTS = [
  { width: 320, height: 640, name: '320_SmallMobile' },
  { width: 360, height: 740, name: '360_Android' },
  { width: 375, height: 812, name: '375_iPhoneSE' },
  { width: 390, height: 844, name: '390_iPhone14' },
  { width: 414, height: 896, name: '414_iPhonePlus' },
  { width: 430, height: 932, name: '430_iPhoneProMax' }
];

const PAGES_TO_TEST = [
  { path: '/', name: 'Landing' },
  { path: '/login', name: 'Login' },
  { path: '/register', name: 'Register' },
  { path: '/ambulance', name: 'Ambulance' },
  { path: '/police', name: 'Police' },
  { path: '/hospital', name: 'Hospital' },
  { path: '/admin', name: 'Admin' }
];

async function runMobileAudit() {
  console.log('=== AERO Mobile Responsiveness & Layout Audit ===\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const results = [];

  for (const pageInfo of PAGES_TO_TEST) {
    console.log(`\nTesting Page: ${pageInfo.name} (${pageInfo.path})`);
    const page = await browser.newPage();

    for (const vp of VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height, isMobile: true, hasTouch: true });
      try {
        await page.goto(`http://localhost:5173${pageInfo.path}`, { waitUntil: 'networkidle0', timeout: 15000 });
      } catch (err) {
        // Fallback with domcontentloaded
        try {
          await page.goto(`http://localhost:5173${pageInfo.path}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
        } catch (e) {
          console.error(`  [${vp.name}] Failed to load: ${e.message}`);
          continue;
        }
      }

      // Check horizontal overflow
      const overflowInfo = await page.evaluate(() => {
        const docWidth = document.documentElement.offsetWidth;
        const scrollWidth = document.documentElement.scrollWidth;
        const windowWidth = window.innerWidth;
        const hasHorizontalOverflow = scrollWidth > windowWidth;

        // Find elements causing overflow
        const overflowingElements = [];
        if (hasHorizontalOverflow) {
          const all = document.querySelectorAll('*');
          for (const el of all) {
            const rect = el.getBoundingClientRect();
            if (rect.right > windowWidth + 1) {
              overflowingElements.push({
                tag: el.tagName,
                className: el.className ? String(el.className).substring(0, 50) : '',
                id: el.id || '',
                right: Math.round(rect.right),
                width: Math.round(rect.width)
              });
              if (overflowingElements.length >= 5) break;
            }
          }
        }

        return {
          windowWidth,
          scrollWidth,
          hasHorizontalOverflow,
          overflowingElements
        };
      });

      const status = overflowInfo.hasHorizontalOverflow ? 'FAIL (Overflow)' : 'PASS';
      console.log(`  [${vp.width}px - ${vp.name}]: ${status} (scrollWidth: ${overflowInfo.scrollWidth}px vs window: ${overflowInfo.windowWidth}px)`);
      if (overflowInfo.hasHorizontalOverflow) {
        console.log('    Culprits:', JSON.stringify(overflowInfo.overflowingElements));
      }

      results.push({
        page: pageInfo.name,
        width: vp.width,
        status,
        ...overflowInfo
      });
    }
    await page.close();
  }

  await browser.close();
  console.log('\n=== Mobile Responsiveness Audit Complete ===');
}

runMobileAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
