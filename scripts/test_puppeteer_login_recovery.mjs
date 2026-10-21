import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

async function testRecoveryFlow() {
  console.log('\n======================================================');
  console.log('   PUPPETEER E2E TEST: LOGIN, RECOVERY & RESEND UI');
  console.log('======================================================\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const scratchDir = 'scratch';
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

  const targets = [
    { name: 'Localhost', url: 'http://localhost:5173/login' },
    { name: 'LAN Origin', url: 'http://192.168.1.39:5173/login' }
  ];

  for (const target of targets) {
    console.log(`\n--- Testing ${target.name} (${target.url}) ---`);
    await page.goto(target.url, { waitUntil: 'networkidle2' });

    // 1. Verify Login Page renders
    const title = await page.title();
    console.log(`✓ Page Title: "${title}"`);

    // 2. Open Recovery Modal via "Forgot Password?"
    const forgotBtn = await page.waitForSelector('button ::-p-text(Forgot Password?)');
    await forgotBtn.click();
    console.log('✓ Clicked "Forgot Password?" button');

    // 3. Verify modal opened and has both tabs
    await page.waitForSelector('button ::-p-text(Reset Password)');
    await page.waitForSelector('button ::-p-text(Resend Confirmation)');
    console.log('✓ Recovery Modal opened with dual tabs: [Reset Password] and [Resend Confirmation]');

    // 4. Test client-side email validation in Reset Password tab
    const emailInput = await page.waitForSelector('input[placeholder="operator@agency.org"]');
    await emailInput.click({ clickCount: 3 });
    await emailInput.type('operator@example.com');

    const submitBtn = await page.waitForSelector('button ::-p-text(SEND RECOVERY EMAIL)');
    await submitBtn.click();
    console.log('✓ Submitted domain "example.com" to test deliverability filter');

    // Wait for validation error to appear (reserved test domain blocked to prevent bounces)
    await page.waitForFunction(() => {
      const el = document.querySelector('.bg-\\[\\#E53935\\]\\/15');
      return el && el.textContent.length > 0;
    }, { timeout: 5000 });
    console.log('✓ Client-side deliverability validator displayed error properly');

    // 5. Test switching to "Resend Confirmation" tab
    const resendTab = await page.waitForSelector('button ::-p-text(Resend Confirmation)');
    await resendTab.click();
    await page.waitForSelector('button ::-p-text(RESEND CONFIRMATION EMAIL)');
    console.log('✓ Switched to "Resend Confirmation" tab: button updated to "RESEND CONFIRMATION EMAIL"');

    // 6. Screenshot modal state
    const shotPath = path.join(scratchDir, `screenshot_modal_${target.name.toLowerCase().replace(/\s+/g, '_')}.png`);
    await page.screenshot({ path: shotPath });
    console.log(`✓ Saved screenshot to ${shotPath}`);

    // 7. Close modal
    const closeBtn = await page.waitForSelector('button ::-p-text(Back to Sign In)');
    await closeBtn.click();
    console.log('✓ Closed modal via "Back to Sign In"');

    // Wait for modal exit animation to complete
    await page.waitForFunction(() => !document.querySelector('.fixed.inset-0.z-50'), { timeout: 3000 });

    // 8. Test error banner trigger on main form
    const submitLoginBtn = await page.waitForSelector('button ::-p-text(Sign In to AERO)');
    await submitLoginBtn.click();
    await page.waitForSelector('button ::-p-text(Reset password →)', { timeout: 5000 });
    await page.waitForSelector('button ::-p-text(Resend confirmation email →)', { timeout: 5000 });
    console.log('✓ Login error box rendered with "Reset password →" and "Resend confirmation email →" action links');
  }

  await browser.close();
  console.log('\n======================================================');
  console.log('   ALL PUPPETEER UI TESTS PASSED SUCCESSFULLY!       ');
  console.log('======================================================\n');
}

testRecoveryFlow().catch(err => {
  console.error('Puppeteer E2E test error:', err);
  process.exit(1);
});
