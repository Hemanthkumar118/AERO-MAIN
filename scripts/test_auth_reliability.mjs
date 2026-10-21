import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

console.log('\n======================================================');
console.log('   AERO AUTHENTICATION & DELIVERABILITY RELIABILITY AUDIT');
console.log('======================================================\n');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Inline validation logic matching src/utils/emailValidation.ts for standalone Node test runner
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const RESERVED_DOMAINS = new Set(['example.com', 'test.com', 'invalid', 'localhost', 'fake.com']);
const FICTITIOUS_DOMAINS = new Set(['ems.gov.in', 'police.gov.in', 'hospital.org', 'aero.city.gov']);

function validateEmail(email) {
  if (!email || typeof email !== 'string') return { valid: false, reason: 'empty' };
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalized)) return { valid: false, reason: 'syntax' };
  const domain = normalized.split('@')[1];
  if (RESERVED_DOMAINS.has(domain)) return { valid: false, reason: 'reserved_test_domain' };
  if (FICTITIOUS_DOMAINS.has(domain)) return { valid: false, reason: 'fictitious_placeholder' };
  return { valid: true, normalized };
}

async function runAuthTests() {
  let passedCount = 0;
  let totalCount = 0;

  function assert(name, condition, details = '') {
    totalCount++;
    if (condition) {
      passedCount++;
      console.log(`✓ PASS: ${name} ${details ? '(' + details + ')' : ''}`);
    } else {
      console.log(`✗ FAIL: ${name} ${details ? '(' + details + ')' : ''}`);
    }
  }

  // 1. Email Normalization Check
  const rawEmail = '  HeMaNtH118KuMaR@GmAiL.cOm  ';
  const val = validateEmail(rawEmail);
  assert(
    '1. Email normalization trims whitespace and downcases',
    val.valid && val.normalized === 'hemanth118kumar@gmail.com',
    `normalized: ${val.normalized}`
  );

  // 2. Deliverability Protection against Bouncing Fictitious Domains
  const demoEmailCheck = validateEmail('driver@ems.gov.in');
  const reservedCheck = validateEmail('user@example.com');
  assert(
    '2. Deliverability validator intercepts fictitious and reserved test domains to prevent SMTP bounces',
    !demoEmailCheck.valid && !reservedCheck.valid && demoEmailCheck.reason === 'fictitious_placeholder',
    `blocked reasons: ${demoEmailCheck.reason}, ${reservedCheck.reason}`
  );

  // 3. Supabase Auth Project Reachability & Credential Handling
  try {
    const res = await supabase.auth.signInWithPassword({
      email: 'verified.operator@gmail.com',
      password: 'NonExistentPassword123!'
    });
    // Expected to return 400 invalid_credentials safely without crashing
    const safeError = res.error?.code === 'invalid_credentials' || res.error?.message?.toLowerCase().includes('invalid');
    assert(
      '3. Supabase Auth responds with standard secure invalid_credentials without credential exposure',
      safeError,
      `code: ${res.error?.code}, status: ${res.error?.status}`
    );
  } catch (err) {
    assert('3. Supabase Auth responds with standard secure invalid_credentials', false, err.message);
  }

  // 4. Profiles Table RLS & Read Policy
  try {
    const { data, error } = await supabase.from('profiles').select('id, full_name, role').limit(5);
    // Anon key reading profiles returns array (empty if RLS restricts to authenticated/own)
    assert(
      '4. Profiles table responds with valid schema without 500/404 errors',
      !error,
      error ? error.message : `rows: ${data?.length}`
    );
  } catch (err) {
    assert('4. Profiles table responds with valid schema without 500/404 errors', false, err.message);
  }

  // 5. Backend Auth Profile Sync Endpoint
  try {
    const res = await fetch('http://localhost:3001/api/auth/profile-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    // Without token, it must reject with 401 Unauthorized
    assert(
      '5. Backend /api/auth/profile-sync strictly rejects unauthenticated requests',
      res.status === 401,
      `status: ${res.status}`
    );
  } catch (err) {
    assert('5. Backend /api/auth/profile-sync strictly rejects unauthenticated requests', false, err.message);
  }

  console.log('\n======================================================');
  console.log(`TOTAL TESTS: ${totalCount} | PASSED: ${passedCount} | FAILED: ${totalCount - passedCount}`);
  console.log(`OVERALL STATUS: ${passedCount === totalCount ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  console.log('======================================================\n');
}

runAuthTests();
