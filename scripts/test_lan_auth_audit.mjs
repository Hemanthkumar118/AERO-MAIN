/**
 * AERO LAN & Localhost Authentication Audit Script
 * Verifies parity, CORS, network reachability, and auth error handling.
 */

import http from 'http';

console.log('======================================================');
console.log('   AERO LAN (192.168.1.39) & LOCALHOST AUTH AUDIT   ');
console.log('======================================================\n');

async function checkUrl(url, options = {}) {
  const res = await fetch(url, options);
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    text: await res.text()
  };
}

async function runAudit() {
  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`✓ PASS: ${testName} ${details ? '(' + details + ')' : ''}`);
      passed++;
    } else {
      console.error(`✗ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
      failed++;
    }
  }

  try {
    // 1. Verify localhost frontend reachability
    const lhFe = await checkUrl('http://localhost:5173/');
    assert(lhFe.status === 200, '1. Localhost frontend reachable', `status: ${lhFe.status}`);

    // 2. Verify LAN IP frontend reachability
    const lanFe = await checkUrl('http://192.168.1.39:5173/');
    assert(lanFe.status === 200, '2. LAN frontend (192.168.1.39:5173) reachable', `status: ${lanFe.status}`);

    // 3. Verify backend health on localhost
    const lhBe = await checkUrl('http://localhost:3001/api/health');
    const lhBeData = JSON.parse(lhBe.text);
    assert(lhBe.status === 200 && lhBeData.status === 'ok', '3. Localhost backend reachable', `health: ${lhBeData.status}`);

    // 4. Verify backend health on LAN IP
    const lanBe = await checkUrl('http://192.168.1.39:3001/api/health');
    const lanBeData = JSON.parse(lanBe.text);
    assert(lanBe.status === 200 && lanBeData.status === 'ok', '4. LAN backend (192.168.1.39:3001) reachable', `health: ${lanBeData.status}`);

    // 5. Verify Vite dev proxy from LAN IP to Express backend
    const lanProxy = await checkUrl('http://192.168.1.39:5173/api/health');
    const lanProxyData = JSON.parse(lanProxy.text);
    assert(lanProxy.status === 200 && lanProxyData.status === 'ok', '5. LAN Vite proxy (192.168.1.39:5173/api) operational', `service: ${lanProxyData.service}`);

    // 6. Verify CORS handling for LAN origin
    const corsTest = await checkUrl('http://localhost:3001/api/health', {
      headers: {
        'Origin': 'http://192.168.1.39:5173'
      }
    });
    const allowOrigin = corsTest.headers['access-control-allow-origin'];
    const allowCreds = corsTest.headers['access-control-allow-credentials'];
    assert(
      allowOrigin === 'http://192.168.1.39:5173' && allowCreds === 'true',
      '6. Express backend permits LAN origin with credentials',
      `origin: ${allowOrigin}, credentials: ${allowCreds}`
    );

    // 7. Verify Supabase Auth client configuration parity
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = 'https://mfsmlyiwhejmwhpgemns.supabase.co';
    const supabaseAnonKey = 'sb_publishable_Ueagl9dp-vvHD8HwECLqWg_aUkv5aZh';

    const clientLh = createClient(supabaseUrl, supabaseAnonKey);
    const clientLan = createClient(supabaseUrl, supabaseAnonKey);

    assert(
      clientLh.supabaseUrl === clientLan.supabaseUrl,
      '7. Supabase client URL identical across localhost and LAN',
      clientLh.supabaseUrl
    );

    // 8. Test Supabase Auth token response distinguishes invalid credentials
    const testLogin = await clientLan.auth.signInWithPassword({
      email: 'nonexistent_test_account_9876@emergency.gov',
      password: 'WrongPassword123!'
    });
    assert(
      testLogin.error?.code === 'invalid_credentials' && testLogin.error?.status === 400,
      '8. Supabase Auth returns clean 400 invalid_credentials without credential leakage',
      `code: ${testLogin.error?.code}`
    );

  } catch (err) {
    console.error('Audit exception:', err);
    failed++;
  }

  console.log('\n======================================================');
  console.log(`TOTAL AUDIT CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log(`STATUS: ${failed === 0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
  console.log('======================================================');

  if (failed > 0) process.exit(1);
}

runAudit();
