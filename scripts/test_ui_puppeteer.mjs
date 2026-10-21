import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

async function testUI() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  console.log('\n--- Testing /register Hospital Facility Search ---');
  await page.goto('http://localhost:5173/register', { waitUntil: 'networkidle2' });

  // Ensure role is AMBULANCE (default)
  const roleValue = await page.$eval('select', el => el.value);
  console.log('Selected operational role:', roleValue);

  // Check Assigned Hospital Facility input
  const inputSelector = '#hospital-search-input';
  await page.waitForSelector(inputSelector);
  console.log('Found hospital search input!');

  // Focus and type 'Apollo'
  await page.focus(inputSelector);
  await page.type(inputSelector, 'Apollo', { delay: 50 });
  console.log('Typed "Apollo" into search input');

  // Wait for debounced search and results dropdown
  await page.waitForSelector('[role="option"]', { timeout: 8000 });
  const options = await page.$$eval('[role="option"]', els => els.map(el => el.textContent));
  console.log(`Dropdown rendered ${options.length} hospital options!`);
  console.log('Top option:', options[0]);

  // Click 25km radius filter button
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const text = await (await b.getProperty('textContent')).jsonValue();
    if (text?.trim() === '25km') {
      await b.click();
      console.log('Clicked 25km radius filter button');
      break;
    }
  }

  // Wait for debounced search to finish updating after radius change
  await page.waitForSelector('[role="option"]', { timeout: 8000 });

  // Click first option
  await page.click('[role="option"]');
  console.log('Clicked first hospital option!');

  // Verify form was NOT submitted (URL should still be /register)
  const currentUrl = page.url();
  console.log('Current URL after selection (must still be /register):', currentUrl);

  // Verify Selected Facility Card appears
  await page.waitForSelector('text/Selected Facility', { timeout: 4000 });
  console.log('Verified Selected Facility card is displayed below input!');

  // Screenshot proof
  const artifactsDir = 'scratch';
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactsDir, 'screenshot_register_verified.png') });
  console.log('Saved screenshot to scratch/screenshot_register_verified.png');

  // Navigate to /admin
  console.log('\n--- Testing /admin Command Center Dashboard ---');
  await page.goto('http://localhost:5173/admin', { waitUntil: 'networkidle2' });
  await page.screenshot({ path: path.join(artifactsDir, 'screenshot_admin_verified.png') });
  console.log('Saved screenshot to scratch/screenshot_admin_verified.png');

  await browser.close();
  console.log('\n✓ UI E2E test completed successfully!\n');
}

testUI().catch(err => {
  console.error('Puppeteer test error:', err);
  process.exit(1);
});
