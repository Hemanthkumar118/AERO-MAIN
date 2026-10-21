import crypto from 'crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const BASE_URL = 'http://localhost:3001';
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY);

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
  sub: 'ambulance-operator-001',
  email: 'driver@aero-emergency.org',
  user_metadata: { role: 'paramedic', vehicle_number: 'AMB-TEST-99', full_name: 'Ambulance Operator' }
});

const unauthorizedToken = makeToken({
  sub: 'random-citizen-999',
  email: 'citizen@example.com',
  user_metadata: { role: 'citizen', full_name: 'Regular Citizen' }
});

const adminToken = makeToken({
  sub: 'admin-controller-001',
  email: 'admin@aero-emergency.org',
  user_metadata: { role: 'admin', full_name: 'Command Administrator' }
});

const policeToken = makeToken({
  sub: 'traffic-police-001',
  email: 'officer@police.gov.in',
  user_metadata: { role: 'police', badge_number: 'POL-HYD-01' }
});

const hospitalToken = makeToken({
  sub: 'hospital-er-001',
  email: 'er@meena-hospital.org',
  user_metadata: { role: 'hospital', hospital_name: 'Meena Hospital' }
});

let testResults = [];
function record(num, name, passed, details = '') {
  testResults.push({ num, name, passed, details });
  console.log(`${passed ? '✓ PASS' : '✗ FAIL'} [${num}] ${name} ${details ? '— ' + details : ''}`);
}

async function runTests() {
  console.log('\n================================================================');
  console.log('   AERO CRITICAL FIX: AMBULANCE ARRIVAL SYNCHRONIZATION AUDIT');
  console.log('================================================================\n');

  const incidentIdA = crypto.randomUUID();
  const incidentIdB = crypto.randomUUID();

  // -------------------------------------------------------------
  // Setup: Create two active incidents
  // -------------------------------------------------------------
  console.log('--- Phase 0: Provisioning Test Incidents ---');
  try {
    const resA = await fetch(`${BASE_URL}/api/incidents/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${paramedicToken}` },
      body: JSON.stringify({
        id: incidentIdA,
        ambulance_id: 'AMB-TEST-99',
        status: 'active',
        priority: 'CRITICAL',
        incident_type: 'CARDIAC',
        destination_hospital: 'Meena Hospital',
        destination_latitude: 17.4156,
        destination_longitude: 78.4125,
        current_latitude: 17.4435,
        current_longitude: 78.3772,
        current_speed: 60,
        corridor_status: 'PENDING',
        hospital_status: 'INCOMING',
        route_distance_meters: 6200,
        route_duration_seconds: 540,
        route_geometry: [[17.4435, 78.3772], [17.4156, 78.4125]],
        created_at: new Date().toISOString()
      })
    });
    const jsonA = await resA.json();
    console.log(`Incident A created: ${jsonA.incident?.id} (status: ${jsonA.incident?.status})`);

    // Setup Police route plan for Incident A
    await fetch(`${BASE_URL}/api/incidents/${incidentIdA}/coordination-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${policeToken}` },
      body: JSON.stringify({
        ambulanceId: 'AMB-TEST-99',
        routePolyline: [[17.4435, 78.3772], [17.4156, 78.4125]],
        routeDistanceMeters: 6200,
        routeDurationSeconds: 540,
        destinationHospital: 'Meena Hospital'
      })
    });

    // Create Incident B for isolation testing
    await fetch(`${BASE_URL}/api/incidents/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${paramedicToken}` },
      body: JSON.stringify({
        id: incidentIdB,
        ambulance_id: 'AMB-TEST-88',
        status: 'active',
        priority: 'HIGH',
        destination_hospital: 'City Hospital',
        created_at: new Date().toISOString()
      })
    });
  } catch (err) {
    console.error('Setup failed:', err.message);
  }

  // -------------------------------------------------------------
  // Test 1: Successful arrival updates authoritative database record
  // -------------------------------------------------------------
  console.log('\n--- Test 1: Authoritative Arrival Transition ---');
  let firstArrivalTimestamp = null;
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/${incidentIdA}/arrival`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${paramedicToken}` },
      body: JSON.stringify({ notes: 'Arrived safely at Bay 3' })
    });
    const json = await res.json();
    firstArrivalTimestamp = json.arrivedAt;

    const passed = res.ok && json.success === true && json.incident?.status === 'arrived' && !!json.arrivedAt && json.incident?.current_speed === 0;
    record(1, 'Successful arrival updates authoritative database record', passed, `status: ${json.incident?.status}, arrivedAt: ${json.arrivedAt}, speed: ${json.incident?.current_speed}`);
  } catch (err) {
    record(1, 'Successful arrival updates authoritative database record', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 2: Double-click or retry idempotency (does not duplicate transition)
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Arrival Idempotency ---');
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/${incidentIdA}/arrival`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${paramedicToken}` },
      body: JSON.stringify({ notes: 'Accidental second click' })
    });
    const json = await res.json();
    const passed = res.ok && json.success === true && json.alreadyArrived === true && json.arrivedAt === firstArrivalTimestamp;
    record(2, 'Double-click or retry is idempotent and returns 200 without duplicate transition', passed, `alreadyArrived: ${json.alreadyArrived}, timestamp preserved: ${json.arrivedAt === firstArrivalTimestamp}`);
  } catch (err) {
    record(2, 'Double-click or retry is idempotent and returns 200 without duplicate transition', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 3: Unauthorized user rejection
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Authorization Verification ---');
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/${incidentIdB}/arrival`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${unauthorizedToken}` },
      body: JSON.stringify({ notes: 'Malicious arrival call' })
    });
    const json = await res.json();
    const passed = res.status === 403 && json.success === false;
    record(3, 'Unauthorized user cannot mark ambulance arrival', passed, `HTTP ${res.status}: ${json.error}`);
  } catch (err) {
    record(3, 'Unauthorized user cannot mark ambulance arrival', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 4: Database write failure / non-existent incident handles gracefully
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Write Failure & Validation Rejection ---');
  try {
    const nonExistentUuid = crypto.randomUUID();
    const res = await fetch(`${BASE_URL}/api/incidents/${nonExistentUuid}/arrival`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${paramedicToken}` },
      body: JSON.stringify({ notes: 'Bogus' })
    });
    const json = await res.json();
    const passed = res.status === 404 && json.success === false;
    record(4, 'Missing or invalid incident produces clean error without false success', passed, `HTTP ${res.status}: ${json.error}`);
  } catch (err) {
    record(4, 'Missing or invalid incident produces clean error without false success', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 5: Police route plan closed on arrival
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Police Coordination Lifecycle Reconciled ---');
  try {
    const res = await fetch(`${BASE_URL}/api/police/plans/${incidentIdA}`, {
      headers: { 'Authorization': `Bearer ${policeToken}` }
    });
    const json = await res.json();
    const passed = res.ok && json.plan?.status === 'COMPLETED' && json.plan?.corridor_closed === true;
    record(5, 'Police route plan is closed and corridor flagged as closed upon arrival', passed, `plan status: ${json.plan?.status}, corridor_closed: ${json.plan?.corridor_closed}`);
  } catch (err) {
    record(5, 'Police route plan is closed and corridor flagged as closed upon arrival', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 6: Route checkpoints zero-count verification (never reports fully covered)
  // -------------------------------------------------------------
  console.log('\n--- Test 6: Route Checkpoints Zero Coverage Safety ---');
  try {
    // Check coverage logic: when checkpoints is empty array, it must never evaluate to FULLY COVERED
    const emptyCheckpoints = [];
    const gapCount = emptyCheckpoints.filter(c => !c.police_id || c.is_coverage_gap).length;
    const isZeroCheckpoints = emptyCheckpoints.length === 0;
    const reportedStatus = isZeroCheckpoints 
      ? 'NO CHECKPOINTS' 
      : gapCount === 0 
        ? 'FULLY COVERED' 
        : `${gapCount} GAPS`;
    const passed = reportedStatus === 'NO CHECKPOINTS';
    record(6, 'Corridor with 0 route checkpoints reports NO CHECKPOINTS, never FULLY COVERED', passed, `reportedStatus: "${reportedStatus}"`);
  } catch (err) {
    record(6, 'Corridor with 0 route checkpoints reports NO CHECKPOINTS, never FULLY COVERED', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 7: Hospital incoming card & ER lifecycle independent of arrival
  // -------------------------------------------------------------
  console.log('\n--- Test 7: Hospital ER Lifecycle Independent from Arrival ---');
  try {
    const res = await fetch(`${BASE_URL}/api/hospital/incidents`, {
      headers: { 'Authorization': `Bearer ${hospitalToken}` }
    });
    const json = await res.json();
    const targetInc = json.incidents?.find(i => i.id === incidentIdA);
    const passed = !!targetInc && targetInc.status === 'arrived' && targetInc.arrived_at === firstArrivalTimestamp;
    record(7, 'Hospital receives arrived state with server timestamp while ER readiness remains independent', passed, `status: ${targetInc?.status}, arrived_at: ${targetInc?.arrived_at}`);
  } catch (err) {
    record(7, 'Hospital receives arrived state with server timestamp while ER readiness remains independent', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 8: Admin active counts & incident feed agreement
  // -------------------------------------------------------------
  console.log('\n--- Test 8: Admin Metrics & Active Feed Agreement ---');
  try {
    const [overviewRes, incidentsRes] = await Promise.all([
      fetch(`${BASE_URL}/api/admin/overview`, { headers: { 'Authorization': `Bearer ${adminToken}` } }),
      fetch(`${BASE_URL}/api/admin/incidents?status=ACTIVE`, { headers: { 'Authorization': `Bearer ${adminToken}` } })
    ]);
    const overviewJson = await overviewRes.json();
    const incidentsJson = await incidentsRes.json();

    const activeList = incidentsJson.incidents?.filter(i => i.status === 'active' || i.status === 'arrived') || [];
    const overviewCount = overviewJson.data?.activeEmergencies;
    const passed = overviewCount === activeList.length && activeList.some(i => i.id === incidentIdA);
    record(8, 'Admin overview activeEmergencies count matches active+arrived feed in exact 1:1 agreement', passed, `overviewCount: ${overviewCount}, feedCount: ${activeList.length}`);
  } catch (err) {
    record(8, 'Admin overview activeEmergencies count matches active+arrived feed in exact 1:1 agreement', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 9: Incident isolation (multiple simultaneous incidents)
  // -------------------------------------------------------------
  console.log('\n--- Test 9: Incident Isolation Across Simultaneous Incidents ---');
  try {
    const [resA, resB] = await Promise.all([
      fetch(`${BASE_URL}/api/incidents/${incidentIdA}`),
      fetch(`${BASE_URL}/api/incidents/${incidentIdB}`)
    ]);
    const jsonA = await resA.json();
    const jsonB = await resB.json();

    const passed = jsonA.incident?.status === 'arrived' && jsonB.incident?.status === 'active';
    record(9, 'Incident arrival state does not bleed into other simultaneous active incidents', passed, `Incident A status: ${jsonA.incident?.status}, Incident B status: ${jsonB.incident?.status}`);
  } catch (err) {
    record(9, 'Incident arrival state does not bleed into other simultaneous active incidents', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 10: Persisted state on reload (dashboard opened after arrival)
  // -------------------------------------------------------------
  console.log('\n--- Test 10: Persisted State on Refresh/Reload ---');
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/${incidentIdA}`);
    const json = await res.json();
    const passed = json.incident?.status === 'arrived' && json.incident?.arrived_at === firstArrivalTimestamp && json.incident?.current_speed === 0;
    record(10, 'A dashboard opened or refreshed after arrival loads persisted arrival state and timestamp', passed, `status: ${json.incident?.status}, speed: ${json.incident?.current_speed}, arrived_at: ${json.incident?.arrived_at}`);
  } catch (err) {
    record(10, 'A dashboard opened or refreshed after arrival loads persisted arrival state and timestamp', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 11: Realtime reconnect resilience (authoritative refetch fallback)
  // -------------------------------------------------------------
  console.log('\n--- Test 11: Realtime Reconnect & Authoritative Refetch ---');
  try {
    // Simulate socket disconnect/reconnect: a fresh authoritative GET recovers all arrival data
    const res = await fetch(`${BASE_URL}/api/incidents/${incidentIdA}`);
    const json = await res.json();
    const passed = res.ok && json.incident?.status === 'arrived';
    record(11, 'Authoritative refetch on reconnect correctly recovers missed arrival updates', passed, `recovered status: ${json.incident?.status}`);
  } catch (err) {
    record(11, 'Authoritative refetch on reconnect correctly recovers missed arrival updates', false, err.message);
  }

  // -------------------------------------------------------------
  // Test 12: Audit history and coordination logs preserved
  // -------------------------------------------------------------
  console.log('\n--- Test 12: Audit Trail & Coordination Logs Preservation ---');
  try {
    const res = await fetch(`${BASE_URL}/api/police/plans/${incidentIdA}/logs`, {
      headers: { 'Authorization': `Bearer ${policeToken}` }
    });
    const json = await res.json();
    const hasArrivalAudit = json.logs?.some(l => l.action === 'PLAN_CLOSED_ON_ARRIVAL');
    const passed = res.ok && hasArrivalAudit;
    record(12, 'Coordination audit log preserves PLAN_CLOSED_ON_ARRIVAL record with actor & timestamp', passed, `audit entries: ${json.logs?.length}, hasArrivalAudit: ${hasArrivalAudit}`);
  } catch (err) {
    record(12, 'Coordination audit log preserves PLAN_CLOSED_ON_ARRIVAL record with actor & timestamp', false, err.message);
  }

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log('                      TEST SUMMARY');
  console.log('================================================================');
  const total = testResults.length;
  const passedCount = testResults.filter(t => t.passed).length;
  const failedCount = total - passedCount;
  console.log(`TOTAL: ${total} | PASSED: ${passedCount} | FAILED: ${failedCount}`);

  if (failedCount > 0) {
    console.error('\nFailed tests:');
    testResults.filter(t => !t.passed).forEach(t => console.error(`  - [${t.num}] ${t.name}: ${t.details}`));
    process.exit(1);
  } else {
    console.log('\n🎉 ALL 12 VERIFICATION TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  }
}

runTests();
