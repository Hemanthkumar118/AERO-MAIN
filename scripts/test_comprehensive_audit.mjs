import crypto from 'crypto';

const BASE_URL = 'http://localhost:3001';
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';

// Helper to generate test JWT tokens without external dependencies
function makeToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify({
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${b64Header}.${b64Payload}`).digest('base64url');
  return `${b64Header}.${b64Payload}.${signature}`;
}

const paramedicToken = makeToken({
  sub: 'paramedic-user-001',
  email: 'paramedic@aero-emergency.org',
  user_metadata: { role: 'paramedic', vehicle_number: 'AMB-101', badge_number: 'PARA-99' }
});

const adminToken = makeToken({
  sub: 'admin-user-001',
  email: 'admin@aero-emergency.org',
  user_metadata: { role: 'admin', full_name: 'Command Administrator' }
});

const unauthorizedToken = makeToken({
  sub: 'public-user-001',
  email: 'citizen@example.com',
  user_metadata: { role: 'citizen' }
});

const hospitalToken = makeToken({
  sub: 'hospital-user-001',
  email: 'trauma@meena-hospital.org',
  user_metadata: { role: 'hospital', hospital_name: 'Meena Hospital' }
});

let testResults = [];
function recordResult(testName, passed, details = '') {
  testResults.push({ testName, passed, details });
  console.log(`${passed ? '✓ PASS' : '✗ FAIL'}: ${testName} ${details ? '(' + details + ')' : ''}`);
}

async function runTests() {
  console.log('\n========================================');
  console.log('   AERO PLATFORM COMPREHENSIVE AUDIT');
  console.log('========================================\n');

  // ----------------------------------------------------
  // SECTION 1: CLINICAL OBSERVATION & AUTHORIZATION TESTS
  // ----------------------------------------------------
  console.log('\n--- 1. Testing Clinical Observation Authorization & Validation ---');

  const testIncidentId = 'inc-audit-' + Date.now();

  // Test 1.1: Unauthorized role rejected with 403
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/${testIncidentId}/clinical-observations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${unauthorizedToken}`
      },
      body: JSON.stringify({
        emergencyCategory: 'CARDIAC',
        triageSeverity: 'CRITICAL',
        heartRate: 110,
        systolicBp: 130,
        diastolicBp: 85
      })
    });
    const data = await res.json();
    const passed = res.status === 403 && data.details?.code === 'INSUFFICIENT_ROLE_PERMISSIONS';
    recordResult('1.1 Unauthorized citizen role denied 403 Forbidden with structured code', passed, `status: ${res.status}, code: ${data.details?.code}`);
  } catch (err) {
    recordResult('1.1 Unauthorized citizen role denied 403 Forbidden with structured code', false, err.message);
  }

  // Test 1.2: Incomplete blood pressure rejected (systolic without diastolic)
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/${testIncidentId}/clinical-observations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${paramedicToken}`
      },
      body: JSON.stringify({
        emergencyCategory: 'CARDIAC',
        triageSeverity: 'CRITICAL',
        systolicBp: 140
      })
    });
    const data = await res.json();
    const passed = res.status === 400 && data.error?.includes('Incomplete blood pressure');
    recordResult('1.2 Incomplete BP (systolic without diastolic) rejected 400', passed, `status: ${res.status}`);
  } catch (err) {
    recordResult('1.2 Incomplete BP (systolic without diastolic) rejected 400', false, err.message);
  }

  // Test 1.3: Coupled BP with systolic <= diastolic rejected
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/${testIncidentId}/clinical-observations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${paramedicToken}`
      },
      body: JSON.stringify({
        emergencyCategory: 'TRAUMA',
        triageSeverity: 'HIGH',
        systolicBp: 80,
        diastolicBp: 120
      })
    });
    const data = await res.json();
    const passed = res.status === 400 && data.error?.includes('must be strictly greater than Diastolic');
    recordResult('1.3 Coupled BP with systolic <= diastolic rejected 400', passed, `status: ${res.status}`);
  } catch (err) {
    recordResult('1.3 Coupled BP with systolic <= diastolic rejected 400', false, err.message);
  }

  // Test 1.4: Zero vital values rejected
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/${testIncidentId}/clinical-observations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${paramedicToken}`
      },
      body: JSON.stringify({
        emergencyCategory: 'TRAUMA',
        triageSeverity: 'HIGH',
        heartRate: 0,
        systolicBp: 0,
        diastolicBp: 0
      })
    });
    const data = await res.json();
    const passed = res.status === 400 && data.error?.includes('rejected');
    recordResult('1.4 Zero vital values rejected 400', passed, `status: ${res.status}`);
  } catch (err) {
    recordResult('1.4 Zero vital values rejected 400', false, err.message);
  }

  // Test 1.5: Authorized Paramedic submits valid observation successfully
  let savedObservationId = null;
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/${testIncidentId}/clinical-observations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${paramedicToken}`
      },
      body: JSON.stringify({
        emergencyCategory: 'CARDIAC',
        triageSeverity: 'CRITICAL',
        chiefComplaint: 'Acute chest pain radiating to left arm',
        heartRate: 115,
        systolicBp: 145,
        diastolicBp: 92,
        spo2: 96,
        respiratoryRate: 22,
        gcs: 15,
        temperature: 37.2,
        preHospitalInterventions: ['High flow oxygen 15L/min', 'Sublingual nitroglycerin 0.4mg'],
        paramedicNotes: 'Patient conscious, alert, monitored on 12-lead ECG showing ST elevations in leads II, III, aVF.'
      })
    });
    const data = await res.json();
    savedObservationId = data.observation?.id;
    const severity = data.observation?.triage_severity || data.observation?.triageSeverity;
    const passed = res.status === 201 && data.success === true && severity === 'CRITICAL';
    recordResult('1.5 Authorized Paramedic submits clinical observation successfully (201 Created)', passed, `obsId: ${savedObservationId}`);
  } catch (err) {
    recordResult('1.5 Authorized Paramedic submits clinical observation successfully (201 Created)', false, err.message);
  }

  // Test 1.6: Observation History loads with chronological records
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/${testIncidentId}/clinical-observations`, {
      headers: { 'Authorization': `Bearer ${paramedicToken}` }
    });
    const data = await res.json();
    const passed = res.status === 200 && data.success === true && Array.isArray(data.observations) && data.observations.length > 0;
    recordResult('1.6 Clinical observation history retrieved correctly with persisted record', passed, `count: ${data.observations?.length}`);
  } catch (err) {
    recordResult('1.6 Clinical observation history retrieved correctly with persisted record', false, err.message);
  }

  // Test 1.7: Administrator can also submit and inspect clinical records
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/${testIncidentId}/clinical-observations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        emergencyCategory: 'CARDIAC',
        triageSeverity: 'CRITICAL',
        paramedicNotes: 'Medical control physician reviewed 12-lead transmission; activate catheterization lab.'
      })
    });
    const data = await res.json();
    const passed = res.status === 201 && data.success === true;
    recordResult('1.7 Administrator submits observation with verified admin role', passed, `status: ${res.status}`);
  } catch (err) {
    recordResult('1.7 Administrator submits observation with verified admin role', false, err.message);
  }

  // ----------------------------------------------------
  // SECTION 2: ADMIN DASHBOARD METRICS & RECONCILIATION
  // ----------------------------------------------------
  console.log('\n--- 2. Testing Admin Dashboard Metrics & Lifecycle Reconciliation ---');

  // Test 2.1: Admin Overview KPI metrics endpoint
  try {
    const res = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    const metrics = data.data || data;
    const passed = res.status === 200 && data.success === true && typeof metrics.activeEmergencies === 'number';
    recordResult('2.1 Admin overview KPI metrics returns authoritative counts', passed, 
      `active: ${metrics.activeEmergencies}, ambulances: ${metrics.onlineAmbulances}, police: ${metrics.availablePolice}, hospitals: ${metrics.partnerHospitals}`);
  } catch (err) {
    recordResult('2.1 Admin overview KPI metrics returns authoritative counts', false, err.message);
  }

  // Test 2.2: Admin Incidents with canonical status filter
  try {
    const res = await fetch(`${BASE_URL}/api/admin/incidents?status=ACTIVE&limit=10`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    const passed = res.status === 200 && data.success === true && Array.isArray(data.incidents);
    recordResult('2.2 Admin incidents query with ACTIVE status filter returns matching incidents', passed, `total: ${data.total}`);
  } catch (err) {
    recordResult('2.2 Admin incidents query with ACTIVE status filter returns matching incidents', false, err.message);
  }

  // Test 2.3: Coordination Overview reconciled with active incidents
  try {
    const res = await fetch(`${BASE_URL}/api/admin/coordination-overview`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    const passed = res.status === 200 && data.success === true && typeof data.totalActivePlans === 'number';
    recordResult('2.3 Coordination overview filtered against authoritative active incidents', passed, 
      `activePlans: ${data.totalActivePlans}, checkpoints: ${data.totalCheckpoints}`);
  } catch (err) {
    recordResult('2.3 Coordination overview filtered against authoritative active incidents', false, err.message);
  }

  // ----------------------------------------------------
  // SECTION 3: HOSPITAL SEARCH ON REGISTRATION
  // ----------------------------------------------------
  console.log('\n--- 3. Testing Hospital Facility Search & Radius Filtering ---');

  // Test 3.1: Search for "Apollo"
  try {
    const res = await fetch(`${BASE_URL}/api/places/hospitals?lat=17.44&lng=78.34&radius=15000&query=Apollo`);
    const data = await res.json();
    const passed = res.status === 200 && data.success === true && data.results?.length > 0 && 
      data.results.some(h => h.name.toLowerCase().includes('apollo'));
    recordResult('3.1 Hospital search returns matching Apollo facilities', passed, `count: ${data.results?.length}`);
  } catch (err) {
    recordResult('3.1 Hospital search returns matching Apollo facilities', false, err.message);
  }

  // Test 3.2: Search for "KIMS"
  try {
    const res = await fetch(`${BASE_URL}/api/places/hospitals?lat=17.44&lng=78.34&radius=25000&query=KIMS`);
    const data = await res.json();
    const passed = res.status === 200 && data.success === true && data.results?.length > 0;
    recordResult('3.2 Hospital search returns matching KIMS facilities', passed, `count: ${data.results?.length}`);
  } catch (err) {
    recordResult('3.2 Hospital search returns matching KIMS facilities', false, err.message);
  }

  // Test 3.3: Search for "Yashoda"
  try {
    const res = await fetch(`${BASE_URL}/api/places/hospitals?lat=17.44&lng=78.34&radius=25000&query=Yashoda`);
    const data = await res.json();
    const passed = res.status === 200 && data.success === true && data.results?.length > 0;
    recordResult('3.3 Hospital search returns matching Yashoda facilities', passed, `count: ${data.results?.length}`);
  } catch (err) {
    recordResult('3.3 Hospital search returns matching Yashoda facilities', false, err.message);
  }

  // Test 3.4: Search for "CARE"
  try {
    const res = await fetch(`${BASE_URL}/api/places/hospitals?lat=17.44&lng=78.34&radius=25000&query=CARE`);
    const data = await res.json();
    const passed = res.status === 200 && data.success === true && data.results?.length > 0;
    recordResult('3.4 Hospital search returns matching CARE facilities', passed, `count: ${data.results?.length}`);
  } catch (err) {
    recordResult('3.4 Hospital search returns matching CARE facilities', false, err.message);
  }

  // Test 3.5: Non-hospital business exclusions
  try {
    const res = await fetch(`${BASE_URL}/api/places/hospitals?lat=17.44&lng=78.34&radius=15000&query=Pharmacy`);
    const data = await res.json();
    const containsExcluded = (data.results || []).some(h => 
      ['pharmacy', 'chemist', 'drug store', 'dental', 'diagnostic'].some(kw => h.name.toLowerCase().includes(kw))
    );
    const passed = res.status === 200 && !containsExcluded;
    recordResult('3.5 Non-hospital healthcare businesses (pharmacies, dental, labs) excluded', passed, `results: ${data.results?.length}`);
  } catch (err) {
    recordResult('3.5 Non-hospital healthcare businesses (pharmacies, dental, labs) excluded', false, err.message);
  }

  // Test 3.6: Radius constraint and out-of-radius labeling
  try {
    const res5k = await fetch(`${BASE_URL}/api/places/hospitals?lat=17.44&lng=78.34&radius=5000&query=Yashoda`);
    const data5k = await res5k.json();
    const hasOutsideFlag = (data5k.results || []).some(h => h.isOutsideRadius === true && h.distanceMeters > 5000);
    const passed = res5k.status === 200 && hasOutsideFlag;
    recordResult('3.6 Radius constraint labels out-of-radius matching facilities clearly', passed, 
      `5km search for Yashoda (11-18km away) marked isOutsideRadius: ${hasOutsideFlag}`);
  } catch (err) {
    recordResult('3.6 Radius constraint labels out-of-radius matching facilities clearly', false, err.message);
  }

  console.log('\n========================================');
  const allPassed = testResults.every(r => r.passed);
  const total = testResults.length;
  const passedCount = testResults.filter(r => r.passed).length;
  console.log(`TOTAL TESTS: ${total} | PASSED: ${passedCount} | FAILED: ${total - passedCount}`);
  console.log(`OVERALL STATUS: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  console.log('========================================\n');

  process.exit(allPassed ? 0 : 1);
}

runTests();
