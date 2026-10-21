import crypto from 'crypto';

const BASE_URL = 'http://localhost:3001';
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';

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

const policeToken = makeToken({
  sub: 'police-officer-001',
  email: 'officer@police.gov.in',
  user_metadata: { role: 'police', badge_number: 'POL-01' }
});

const hospitalToken = makeToken({
  sub: 'hospital-user-001',
  email: 'trauma@meena-hospital.org',
  user_metadata: { role: 'hospital', hospital_name: 'Meena Hospital' }
});

const citizenToken = makeToken({
  sub: 'citizen-user-001',
  email: 'citizen@example.com',
  user_metadata: { role: 'citizen' }
});

let testResults = [];
function recordResult(testName, passed, details = '') {
  testResults.push({ testName, passed, details });
  console.log(`${passed ? '✓ PASS' : '✗ FAIL'}: ${testName} ${details ? '(' + details + ')' : ''}`);
}

async function runEndToEndTests() {
  console.log('\n======================================================');
  console.log('   AERO P0/P1 CRITICAL SYNCHRONIZATION & ADMIN AUDIT');
  console.log('======================================================\n');

  const testIncidentId = 'inc-sync-' + Date.now();
  console.log(`Working with Incident ID: ${testIncidentId}\n`);

  // --- Step 1: Create an emergency incident (simulating ambulance SOS) ---
  console.log('--- Step 1: Ambulance SOS Creation & Authoritative Sync ---');
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${paramedicToken}`
      },
      body: JSON.stringify({
        id: testIncidentId,
        ambulance_id: 'AMB-101',
        ambulance_vehicle_number: 'TS09 EM 101',
        status: 'active',
        priority: 'critical',
        incident_type: 'CARDIAC',
        destination_hospital: 'Meena Hospital',
        destination_latitude: 17.4156,
        destination_longitude: 78.4125,
        latitude: 17.4435,
        longitude: 78.3772,
        current_latitude: 17.4435,
        current_longitude: 78.3772,
        current_speed: 45,
        corridor_status: 'PENDING',
        hospital_status: 'ACCEPTED',
        route_distance_meters: 8500,
        route_duration_seconds: 720,
        route_geometry: [
          [17.4435, 78.3772],
          [17.4350, 78.3900],
          [17.4250, 78.4000],
          [17.4156, 78.4125]
        ],
        created_at: new Date().toISOString()
      })
    });
    const json = await res.json();
    const passed = res.ok && json.success && json.incident?.id === testIncidentId;
    recordResult('1. Ambulance SOS creates and persists emergency incident', passed, `id: ${json.incident?.id}, status: ${json.incident?.status}`);
  } catch (err) {
    recordResult('1. Ambulance SOS creates and persists emergency incident', false, err.message);
  }

  // --- Step 2: Verify incident appears on Admin Dashboard & Active Feed ---
  console.log('\n--- Step 2: Admin Dashboard Authoritative Visibility ---');
  try {
    const res = await fetch(`${BASE_URL}/api/admin/incidents?status=ACTIVE`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    const found = json.incidents?.some(i => i.id === testIncidentId);
    recordResult('2.1 Admin active feed displays the new emergency incident', found, `found in ${json.incidents?.length} active incidents`);
  } catch (err) {
    recordResult('2.1 Admin active feed displays the new emergency incident', false, err.message);
  }

  try {
    const res = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    const passed = res.ok && json.success && json.data.activeEmergencies >= 1 && json.data.partnerHospitals >= 3;
    recordResult('2.2 Admin overview reports non-zero active emergencies & partner hospitals', passed, `active: ${json.data?.activeEmergencies}, hospitals: ${json.data?.partnerHospitals}, police: ${json.data?.availablePolice}`);
  } catch (err) {
    recordResult('2.2 Admin overview reports non-zero active emergencies & partner hospitals', false, err.message);
  }

  // --- Step 3: Verify police coordination plan generation for the incident ---
  console.log('\n--- Step 3: Police Route Coordination Plan Generation ---');
  let firstAssignmentId = null;
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/${testIncidentId}/coordination-plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${policeToken}`
      },
      body: JSON.stringify({
        ambulanceId: 'AMB-101',
        routePolyline: [
          [17.4435, 78.3772],
          [17.4350, 78.3900],
          [17.4250, 78.4000],
          [17.4156, 78.4125]
        ],
        routeDistanceMeters: 8500,
        routeDurationSeconds: 720,
        ambulanceLocation: [17.4435, 78.3772],
        destinationHospital: 'Meena Hospital',
        emergencyPriority: 'CODE_RED'
      })
    });
    const json = await res.json();
    firstAssignmentId = json.assignments?.[0]?.id;
    const passed = res.ok && json.success && json.plan?.status === 'ACTIVE' && json.assignments?.length > 0;
    recordResult('3. Police coordination plan generated with ordered checkpoints ahead', passed, `checkpoints: ${json.assignments?.length}, firstAsg: ${firstAssignmentId}`);
  } catch (err) {
    recordResult('3. Police coordination plan generated with ordered checkpoints ahead', false, err.message);
  }

  // --- Step 4: Police Checkpoint Clearance State Transition ---
  console.log('\n--- Step 4: Police Checkpoint Acknowledgment & Clearance ---');
  if (firstAssignmentId) {
    try {
      // 4a. Notify officer
      await fetch(`${BASE_URL}/api/police/assignments/${firstAssignmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${policeToken}` },
        body: JSON.stringify({ status: 'NOTIFIED' })
      });
      // 4b. Officer acknowledges alert
      await fetch(`${BASE_URL}/api/police/assignments/${firstAssignmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${policeToken}` },
        body: JSON.stringify({ status: 'ACKNOWLEDGED' })
      });
      // 4c. Officer in position and ready
      await fetch(`${BASE_URL}/api/police/assignments/${firstAssignmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${policeToken}` },
        body: JSON.stringify({ status: 'READY' })
      });
      // 4d. Confirm clearance
      const res = await fetch(`${BASE_URL}/api/police/assignments/${firstAssignmentId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${policeToken}`
        },
        body: JSON.stringify({
          status: 'CLEARANCE_CONFIRMED',
          notes: 'Intersection cleared for incoming ambulance TS09 EM 101'
        })
      });
      const json = await res.json();
      const passed = res.ok && json.success && json.assignment?.status === 'CLEARANCE_CONFIRMED';
      recordResult('4. Police officer confirms clearance ahead of ambulance through state machine', passed, `newStatus: ${json.assignment?.status}`);
    } catch (err) {
      recordResult('4. Police officer confirms clearance ahead of ambulance through state machine', false, err.message);
    }
  }

  // --- Step 5: Clinical Observations Recording & Authorized Hospital Access ---
  console.log('\n--- Step 5: Clinical Observations & Triage Authorization ---');
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
        heartRate: 118,
        systolicBp: 135,
        diastolicBp: 88,
        spo2: 94,
        respiratoryRate: 22,
        gcs: 14,
        temperature: 37.2,
        notes: 'Patient experiencing severe retrosternal chest pain radiating to left arm'
      })
    });
    const json = await res.json();
    const passed = res.status === 201 && json.success && json.observation?.incident_id === testIncidentId;
    recordResult('5.1 Paramedic records structured vital observations', passed, `obsId: ${json.observation?.id}`);
  } catch (err) {
    recordResult('5.1 Paramedic records structured vital observations', false, err.message);
  }

  try {
    const res = await fetch(`${BASE_URL}/api/incidents/${testIncidentId}/clinical-observations`, {
      headers: { 'Authorization': `Bearer ${hospitalToken}` }
    });
    const json = await res.json();
    const passed = res.ok && json.success && json.observations?.length > 0;
    recordResult('5.2 Receiving hospital securely retrieves patient clinical observations', passed, `count: ${json.observations?.length}, HR: ${json.observations?.[0]?.heart_rate}`);
  } catch (err) {
    recordResult('5.2 Receiving hospital securely retrieves patient clinical observations', false, err.message);
  }

  // --- Step 6: Admin Superuser Edit Incident ---
  console.log('\n--- Step 6: Admin Superuser Edit Controls ---');
  try {
    const res = await fetch(`${BASE_URL}/api/admin/incidents/${testIncidentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        priority: 'critical',
        corridor_status: 'CLEAR',
        description: 'Admin override: corridor declared clear by central dispatch'
      })
    });
    const json = await res.json();
    const passed = res.ok && json.success && json.incident?.corridor_status === 'CLEAR';
    recordResult('6. Admin superuser edits incident priority, corridor status & notes', passed, `corridor_status: ${json.incident?.corridor_status}`);
  } catch (err) {
    recordResult('6. Admin superuser edits incident priority, corridor status & notes', false, err.message);
  }

  // --- Step 7: Complete the emergency & verify move to history ---
  console.log('\n--- Step 7: Incident Completion & History Archival ---');
  try {
    const res = await fetch(`${BASE_URL}/api/admin/incidents/${testIncidentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        status: 'resolved',
        resolved_at: new Date().toISOString()
      })
    });
    const json = await res.json();
    const passed = res.ok && json.success && json.incident?.status === 'resolved';
    recordResult('7.1 Incident completed and marked resolved', passed, `status: ${json.incident?.status}`);
  } catch (err) {
    recordResult('7.1 Incident completed and marked resolved', false, err.message);
  }

  try {
    const res = await fetch(`${BASE_URL}/api/admin/incidents?status=COMPLETED`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    const inHistory = json.incidents?.some(i => i.id === testIncidentId);
    recordResult('7.2 Incident appears in Admin completed history feed', inHistory, `total history: ${json.incidents?.length}`);
  } catch (err) {
    recordResult('7.2 Incident appears in Admin completed history feed', false, err.message);
  }

  // --- Step 8: Admin Superuser Nuke Controls ---
  console.log('\n--- Step 8: Admin Superuser Nuke Controls ---');
  // Create a temporary incident to nuke
  const nukeTestId = 'inc-nuke-target-' + Date.now();
  await fetch(`${BASE_URL}/api/incidents/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ id: nukeTestId, status: 'active', ambulance_id: 'AMB-NUKE' })
  });

  try {
    const res = await fetch(`${BASE_URL}/api/admin/incidents/${nukeTestId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    const passed = res.ok && json.success && json.nukedId === nukeTestId;
    recordResult('8.1 Admin nukes a specific incident completely', passed, `nukedId: ${json.nukedId}`);
  } catch (err) {
    recordResult('8.1 Admin nukes a specific incident completely', false, err.message);
  }

  // Test Nuke All Active
  // Create two active incidents
  const id1 = 'inc-active-1-' + Date.now();
  const id2 = 'inc-active-2-' + Date.now();
  await fetch(`${BASE_URL}/api/incidents/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ id: id1, status: 'active', ambulance_id: 'AMB-1' })
  });
  await fetch(`${BASE_URL}/api/incidents/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ id: id2, status: 'active', ambulance_id: 'AMB-2' })
  });

  try {
    const res = await fetch(`${BASE_URL}/api/admin/incidents/nuke-all`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    const passed = res.ok && json.success && json.nukedCount >= 2;
    recordResult('8.2 Admin nukes all active emergencies in one action', passed, `nukedCount: ${json.nukedCount}`);
  } catch (err) {
    recordResult('8.2 Admin nukes all active emergencies in one action', false, err.message);
  }

  // Verify active count is now 0 after nuke all
  try {
    const res = await fetch(`${BASE_URL}/api/admin/incidents?status=ACTIVE`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const json = await res.json();
    const passed = res.ok && json.incidents?.length === 0;
    recordResult('8.3 Verified active incidents feed is completely clear after nuke all', passed, `active remaining: ${json.incidents?.length}`);
  } catch (err) {
    recordResult('8.3 Verified active incidents feed is completely clear after nuke all', false, err.message);
  }

  // --- Step 9: Unauthorized Security Validation ---
  console.log('\n--- Step 9: Security & Authorization Boundary Checks ---');
  try {
    const res = await fetch(`${BASE_URL}/api/incidents/test-unauth/clinical-observations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${citizenToken}`
      },
      body: JSON.stringify({ emergencyCategory: 'CARDIAC', triageSeverity: 'CRITICAL', heartRate: 90 })
    });
    const passed = res.status === 403;
    recordResult('9. Unauthorized citizen role denied clinical observation access', passed, `status: ${res.status}`);
  } catch (err) {
    recordResult('9. Unauthorized citizen role denied clinical observation access', false, err.message);
  }

  console.log('\n======================================================');
  const allPassed = testResults.every(r => r.passed);
  console.log(`TOTAL TESTS: ${testResults.length} | PASSED: ${testResults.filter(r => r.passed).length} | FAILED: ${testResults.filter(r => !r.passed).length}`);
  console.log(`OVERALL STATUS: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  console.log('======================================================\n');

  if (!allPassed) process.exit(1);
}

runEndToEndTests();
