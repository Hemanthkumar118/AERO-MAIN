import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'police_coordination_store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadLocalStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const data = fs.readFileSync(STORE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('[Police Engine] Failed to read store file, reinitializing:', err.message);
  }
  return { plans: {}, assignments: {}, auditLogs: [], officerStates: {} };
}

function saveLocalStore(store) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Police Engine] Failed to write store file:', err.message);
  }
}

// ==========================================
// SPATIAL & ROUTE MATHEMATICS
// ==========================================

const EARTH_RADIUS_METERS = 6371000;

export function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two [latitude, longitude] points in meters
 */
export function haversineDistance(coordA, coordB) {
  const [lat1, lon1] = Array.isArray(coordA) ? coordA : [coordA.latitude || coordA.lat, coordA.longitude || coordA.lng];
  const [lat2, lon2] = Array.isArray(coordB) ? coordB : [coordB.latitude || coordB.lat, coordB.longitude || coordB.lng];

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(rLat1) * Math.cos(rLat2) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Calculates cumulative distance stationing (in meters) along a polyline.
 * stations[0] = 0, stations[i] = cumulative meters from start to vertex i
 */
export function calculateCumulativeStations(polyline) {
  if (!polyline || polyline.length === 0) return [0];
  const stations = [0];
  let total = 0;
  for (let i = 1; i < polyline.length; i++) {
    const d = haversineDistance(polyline[i - 1], polyline[i]);
    total += d;
    stations.push(total);
  }
  return stations;
}

/**
 * Projects a point onto a single road segment [A, B].
 * Returns: { closestPoint, perpendicularDistance, stationOnSegment }
 */
export function projectPointOntoSegment(point, segStart, segEnd, startStation) {
  const [pLat, pLng] = Array.isArray(point) ? point : [point.latitude || point.lat, point.longitude || point.lng];
  const [aLat, aLng] = segStart;
  const [bLat, bLng] = segEnd;

  // Local flat-earth projection centered at A
  const cosLat = Math.cos(toRadians(aLat));
  const x = toRadians(bLng - aLng) * cosLat * EARTH_RADIUS_METERS;
  const y = toRadians(bLat - aLat) * EARTH_RADIUS_METERS;
  const segLenSq = x * x + y * y;

  if (segLenSq === 0) {
    const d = haversineDistance(point, segStart);
    return {
      closestPoint: [aLat, aLng],
      perpendicularDistance: d,
      routeStation: startStation
    };
  }

  const px = toRadians(pLng - aLng) * cosLat * EARTH_RADIUS_METERS;
  const py = toRadians(pLat - aLat) * EARTH_RADIUS_METERS;

  // Projection factor t clamped between 0 and 1
  const t = Math.max(0, Math.min(1, (px * x + py * y) / segLenSq));

  const cLat = aLat + t * (bLat - aLat);
  const cLng = aLng + t * (bLng - aLng);
  const segDistance = Math.sqrt(segLenSq);
  const perpDist = haversineDistance(point, [cLat, cLng]);

  return {
    closestPoint: [cLat, cLng],
    perpendicularDistance: perpDist,
    routeStation: startStation + t * segDistance
  };
}

/**
 * Projects a target point (e.g. junction or officer) onto the complete route polyline.
 * Finds the segment with minimum perpendicular distance.
 */
export function projectPointOntoRoute(point, polyline, cumulativeStations) {
  if (!polyline || polyline.length < 2) {
    return {
      closestPoint: polyline && polyline.length > 0 ? polyline[0] : [0, 0],
      perpendicularDistance: 0,
      routeStation: 0,
      segmentIndex: 0
    };
  }

  let minPerpDist = Infinity;
  let bestProjection = null;
  let bestSegIdx = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const segStart = polyline[i];
    const segEnd = polyline[i + 1];
    const startStation = cumulativeStations[i];

    const proj = projectPointOntoSegment(point, segStart, segEnd, startStation);
    if (proj.perpendicularDistance < minPerpDist) {
      minPerpDist = proj.perpendicularDistance;
      bestProjection = proj;
      bestSegIdx = i;
    }
  }

  return {
    ...bestProjection,
    segmentIndex: bestSegIdx
  };
}

// ==========================================
// SEED JUNCTIONS & PATROL ROSTER
// Used when database has no seeded arterial checkpoints
// ==========================================

export const DEFAULT_ARTERIAL_JUNCTIONS = [
  {
    id: 'junc-gachibowli-x-roads',
    name: 'Gachibowli X Roads',
    location: { latitude: 17.4401, longitude: 78.3489 },
    defaultPoliceId: 'pol-unit-101',
    defaultPoliceName: 'Insp. R. Verma (Traffic Unit 101)',
    station: 'Gachibowli Traffic PS'
  },
  {
    id: 'junc-biodiversity-circle',
    name: 'Bio-Diversity Park Circle',
    location: { latitude: 17.4344, longitude: 78.3698 },
    defaultPoliceId: 'pol-unit-102',
    defaultPoliceName: 'SI K. Sharma (Traffic Unit 102)',
    station: 'Madhapur Traffic PS'
  },
  {
    id: 'junc-mindspace-junction',
    name: 'Mindspace Rotary Junction',
    location: { latitude: 17.4428, longitude: 78.3812 },
    defaultPoliceId: 'pol-unit-103',
    defaultPoliceName: 'ASI P. Reddy (Traffic Unit 103)',
    station: 'Madhapur Traffic PS'
  },
  {
    id: 'junc-cyber-towers-flyover',
    name: 'Cyber Towers Junction',
    location: { latitude: 17.4504, longitude: 78.3808 },
    defaultPoliceId: 'pol-unit-104',
    defaultPoliceName: 'Insp. M. Khan (Traffic Unit 104)',
    station: 'HITEC City Traffic PS'
  },
  {
    id: 'junc-durgam-cheruvu-incline',
    name: 'Durgam Cheruvu Cable Bridge Junction',
    location: { latitude: 17.4385, longitude: 78.3965 },
    defaultPoliceId: 'pol-unit-105',
    defaultPoliceName: 'SI V. Naidu (Traffic Unit 105)',
    station: 'Jubilee Hills Traffic PS'
  },
  {
    id: 'junc-jubilee-hills-checkpost',
    name: 'Jubilee Hills Checkpost (Rd No 36)',
    location: { latitude: 17.4312, longitude: 78.4075 },
    defaultPoliceId: 'pol-unit-106',
    defaultPoliceName: 'Insp. S. Rao (Traffic Unit 106)',
    station: 'Jubilee Hills Traffic PS'
  },
  {
    id: 'junc-filmnagar-rotary',
    name: 'Film Nagar Rotary',
    location: { latitude: 17.4190, longitude: 78.4110 },
    defaultPoliceId: 'pol-unit-107',
    defaultPoliceName: 'ASI D. Goud (Traffic Unit 107)',
    station: 'Banjara Hills Traffic PS'
  },
  {
    id: 'junc-apollo-hospital-gate',
    name: 'Apollo Hospital Jubilee Hills Entrance',
    location: { latitude: 17.4158, longitude: 78.4128 },
    defaultPoliceId: 'pol-unit-108',
    defaultPoliceName: 'SI N. Chary (Traffic Unit 108)',
    station: 'Banjara Hills Traffic PS'
  },
  {
    id: 'junc-panjagutta-circle',
    name: 'Punjagutta Central Circle',
    location: { latitude: 17.4265, longitude: 78.4518 },
    defaultPoliceId: 'pol-unit-109',
    defaultPoliceName: 'Insp. A. Murthy (Traffic Unit 109)',
    station: 'Punjagutta Traffic PS'
  }
];

export const AVAILABLE_REINFORCEMENT_OFFICERS = [
  {
    policeId: 'pol-reinforce-201',
    name: 'Patrol Squad Alpha (Car 12)',
    badgeNumber: 'TS-TP-201',
    stationName: 'West Zone Flying Squad',
    currentLocation: { latitude: 17.4350, longitude: 78.3850 },
    speedKmH: 45
  },
  {
    policeId: 'pol-reinforce-202',
    name: 'Patrol Squad Bravo (Car 08)',
    badgeNumber: 'TS-TP-202',
    stationName: 'Central Zone Mobile Patrol',
    currentLocation: { latitude: 17.4250, longitude: 78.4150 },
    speedKmH: 40
  },
  {
    policeId: 'pol-reinforce-203',
    name: 'Motorcycle Interceptor Unit 03',
    badgeNumber: 'TS-TP-203',
    stationName: 'Cyberabad Rapid Interceptor',
    currentLocation: { latitude: 17.4450, longitude: 78.3650 },
    speedKmH: 55
  }
];

// ==========================================
// STATE MACHINE VALID TRANSITIONS
// ==========================================

export const VALID_TRANSITIONS = {
  PROPOSED: ['NOTIFIED', 'REJECTED', 'UNAVAILABLE', 'CANCELLED', 'REASSIGNED'],
  NOTIFIED: ['ACKNOWLEDGED', 'REJECTED', 'UNAVAILABLE', 'NO_RESPONSE', 'CANCELLED', 'REASSIGNED'],
  ACKNOWLEDGED: ['EN_ROUTE_TO_POSITION', 'READY', 'REJECTED', 'UNAVAILABLE', 'CANCELLED', 'REASSIGNED'],
  EN_ROUTE_TO_POSITION: ['READY', 'BLOCKED', 'UNAVAILABLE', 'CANCELLED', 'REASSIGNED'],
  READY: ['CLEARANCE_CONFIRMED', 'BLOCKED', 'CANCELLED', 'CLEARANCE_REVOKED'],
  CLEARANCE_CONFIRMED: ['PASSED', 'CLEARANCE_REVOKED', 'COMPLETED', 'CANCELLED'],
  PASSED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  REJECTED: ['REASSIGNED', 'CANCELLED'],
  UNAVAILABLE: ['REASSIGNED', 'CANCELLED'],
  NO_RESPONSE: ['REASSIGNED', 'CANCELLED'],
  BLOCKED: ['CLEARANCE_REVOKED', 'REASSIGNED', 'CANCELLED'],
  CLEARANCE_REVOKED: ['READY', 'BLOCKED', 'REASSIGNED', 'CANCELLED'],
  CANCELLED: [],
  REASSIGNED: ['NOTIFIED', 'CANCELLED']
};

export const policeCoordinationEngine = {
  /**
   * Generates or recalculates a route-based coordination plan for an incident
   */
  async generateCoordinationPlan(params, user, supabase) {
    const {
      incidentId,
      routeDistanceMeters,
      routeDurationSeconds,
      ambulanceLocation,
      corridorDistanceMeters = 350.0,
      routeVersion = 1,
      emergencyPriority = 'CODE_RED'
    } = params;

    const routePolyline = params.routePolyline || params.newRoutePolyline || params.newRouteGeometry || params.routeGeometry;

    if (!incidentId) throw new Error('incidentId is required');
    if (!routePolyline || !Array.isArray(routePolyline) || routePolyline.length < 2) {
      throw new Error('Valid route polyline with at least 2 points is required');
    }

    const localStore = loadLocalStore();
    const now = new Date().toISOString();

    // 1. Calculate cumulative stations along polyline
    const stations = calculateCumulativeStations(routePolyline);
    const totalRouteDist = stations[stations.length - 1] || routeDistanceMeters || 1000;
    const totalDuration = routeDurationSeconds || 600;

    // 2. Project ambulance location to determine current route progress
    const ambPos = ambulanceLocation || routePolyline[0];
    const ambProj = projectPointOntoRoute(ambPos, routePolyline, stations);
    const ambStation = ambProj.routeStation;

    // 3. Load all available junctions (from Supabase or arterial default list)
    let candidateJunctions = [...DEFAULT_ARTERIAL_JUNCTIONS];
    if (supabase) {
      try {
        const { data: dbJunctions } = await supabase.from('junctions').select('*');
        if (dbJunctions && dbJunctions.length > 0) {
          candidateJunctions = dbJunctions.map(j => ({
            id: j.id,
            name: j.name,
            location: j.location?.coordinates
              ? { latitude: j.location.coordinates[1], longitude: j.location.coordinates[0] }
              : { latitude: 0, longitude: 0 },
            defaultPoliceId: j.assigned_police_id,
            station: 'District Traffic Branch'
          }));
        }
      } catch (err) {
        console.warn('[Police Engine] Supabase junctions query warning:', err.message);
      }
    }

    // 4. Project each junction onto route and filter by corridor distance
    const matchedJunctions = [];
    for (const j of candidateJunctions) {
      const proj = projectPointOntoRoute(j.location, routePolyline, stations);
      if (proj.perpendicularDistance <= corridorDistanceMeters) {
        matchedJunctions.push({
          junction: j,
          projection: proj
        });
      }
    }

    // 5. Sort matched junctions strictly by route station (chronological route order)
    matchedJunctions.sort((a, b) => a.projection.routeStation - b.projection.routeStation);

    // 6. Partition into Ahead vs Passed
    // J is ahead if station >= ambStation - 50m
    const aheadJunctions = matchedJunctions.filter(m => m.projection.routeStation >= (ambStation - 50));

    // 7. Plan ID
    const planId = crypto.randomUUID();
    const assignments = [];
    let gapCount = 0;

    // Check active locks across other incidents in localStore
    const activeLocks = new Map(); // policeId -> { incidentId, junctionName }
    Object.values(localStore.assignments).forEach(asg => {
      if (asg.incident_id !== incidentId && ['NOTIFIED', 'ACKNOWLEDGED', 'EN_ROUTE_TO_POSITION', 'READY', 'CLEARANCE_CONFIRMED'].includes(asg.status)) {
        if (asg.police_id) {
          activeLocks.set(asg.police_id, asg);
        }
      }
    });

    // 8. Build ordered assignments (P1, P2, P3...)
    for (let idx = 0; idx < aheadJunctions.length; idx++) {
      const { junction, projection } = aheadJunctions[idx];
      const seqOrder = idx + 1;
      const juncStation = projection.routeStation;
      const distFromAmb = Math.max(0, juncStation - ambStation);
      
      // Calculate estimated ambulance arrival at this junction
      const secondsToJunction = totalRouteDist > 0 ? (distFromAmb / totalRouteDist) * totalDuration : 0;
      const estimatedArrival = new Date(Date.now() + secondsToJunction * 1000).toISOString();

      let assignedPoliceId = junction.defaultPoliceId || null;
      let assignedPoliceName = junction.defaultPoliceName || 'Sector Patrol Officer';
      let isReinforcement = false;

      // Check conflict
      if (assignedPoliceId && activeLocks.has(assignedPoliceId)) {
        const conflictingAsg = activeLocks.get(assignedPoliceId);
        // If conflict exists and current incident is not higher priority, search reinforcement
        console.warn(`[Police Engine] Conflict detected for officer ${assignedPoliceId} at ${junction.name} (locked by incident ${conflictingAsg.incident_id})`);
        assignedPoliceId = null;
      }

      // If no officer or conflict, search reinforcement officers
      if (!assignedPoliceId) {
        const candidateReinforcements = AVAILABLE_REINFORCEMENT_OFFICERS.filter(r => !activeLocks.has(r.policeId));
        // Rank candidates by travel time to junction
        let bestCandidate = null;
        let shortestTravelTime = Infinity;

        for (const candidate of candidateReinforcements) {
          const distToJunc = haversineDistance(candidate.currentLocation, junction.location);
          const travelTimeSec = (distToJunc / ((candidate.speedKmH * 1000) / 3600));
          // Feasibility check: Can officer arrive before ambulance + 60s buffer?
          if (travelTimeSec <= (secondsToJunction + 60) && travelTimeSec < shortestTravelTime) {
            shortestTravelTime = travelTimeSec;
            bestCandidate = candidate;
          }
        }

        if (bestCandidate) {
          assignedPoliceId = bestCandidate.policeId;
          assignedPoliceName = bestCandidate.name;
          isReinforcement = true;
          activeLocks.set(assignedPoliceId, { incidentId, junctionName: junction.name });
        } else {
          // No feasible reinforcement officer available in time -> Flag as genuine coverage gap
          gapCount++;
        }
      }

      const assignmentId = crypto.randomUUID();
      const initialStatus = assignedPoliceId ? 'NOTIFIED' : 'PROPOSED';

      const asgRecord = {
        id: assignmentId,
        plan_id: planId,
        incident_id: incidentId,
        police_id: assignedPoliceId,
        police_name: assignedPoliceName,
        badge_number: `TS-POL-${seqOrder.toString().padStart(2, '0')}`,
        station_name: junction.station || 'District Traffic Sector',
        junction_id: junction.id,
        junction_name: junction.name,
        junction_latitude: junction.location.latitude,
        junction_longitude: junction.location.longitude,
        sequence_order: seqOrder,
        route_station_meters: Math.round(juncStation),
        perpendicular_distance_meters: Math.round(projection.perpendicularDistance * 10) / 10,
        distance_from_ambulance_meters: Math.round(distFromAmb),
        estimated_ambulance_arrival: estimatedArrival,
        status: initialStatus,
        is_reinforcement: isReinforcement,
        traffic_condition: 'NORMAL',
        notification_sent_at: assignedPoliceId ? now : null,
        created_at: now,
        updated_at: now
      };

      assignments.push(asgRecord);
      localStore.assignments[assignmentId] = asgRecord;

      // Log initial transition audit
      localStore.auditLogs.unshift({
        id: crypto.randomUUID(),
        assignment_id: assignmentId,
        incident_id: incidentId,
        from_status: null,
        to_status: initialStatus,
        changed_by: user?.id || null,
        changed_by_name: user?.user_metadata?.full_name || 'System Route Engine',
        actor_role: 'system',
        reason: isReinforcement ? 'Advance reinforcement route dispatch' : (assignedPoliceId ? 'Advance route corridor notification' : 'Coverage gap flagged - no feasible unit in range'),
        created_at: now
      });
    }

    const planRecord = {
      id: planId,
      incident_id: incidentId,
      route_version: routeVersion,
      status: 'ACTIVE',
      total_junctions: aheadJunctions.length,
      cleared_junctions: 0,
      coverage_gap_count: gapCount,
      route_distance_meters: Math.round(totalRouteDist),
      route_duration_seconds: Math.round(totalDuration),
      corridor_distance_meters: corridorDistanceMeters,
      created_at: now,
      updated_at: now
    };

    localStore.plans[planId] = planRecord;
    saveLocalStore(localStore);

    // Try Supabase inserts for persistent data integrity
    if (supabase) {
      try {
        await supabase.from('police_coordination_plans').insert(planRecord);
        if (assignments.length > 0) {
          const dbRows = assignments.map(a => ({
            id: a.id,
            plan_id: a.plan_id,
            incident_id: a.incident_id,
            police_id: a.police_id,
            police_name: a.police_name,
            badge_number: a.badge_number,
            station_name: a.station_name,
            junction_name: a.junction_name,
            junction_latitude: a.junction_latitude,
            junction_longitude: a.junction_longitude,
            junction_geom: `POINT(${a.junction_longitude} ${a.junction_latitude})`,
            sequence_order: a.sequence_order,
            route_station_meters: a.route_station_meters,
            perpendicular_distance_meters: a.perpendicular_distance_meters,
            distance_from_ambulance_meters: a.distance_from_ambulance_meters,
            estimated_ambulance_arrival: a.estimated_ambulance_arrival,
            status: a.status,
            is_reinforcement: a.is_reinforcement,
            notification_sent_at: a.notification_sent_at
          }));
          await supabase.from('police_route_assignments').insert(dbRows);
        }
      } catch (dbErr) {
        console.warn('[Police Engine] Supabase insert warning:', dbErr.message);
      }
    }

    return {
      success: true,
      plan: planRecord,
      assignments,
      summary: {
        totalAhead: aheadJunctions.length,
        assignedUnits: assignments.filter(a => a.police_id).length,
        coverageGaps: gapCount,
        firstUnit: assignments[0] || null
      }
    };
  },

  /**
   * Transition an assignment status through the state machine
   */
  async updateAssignmentStatus(assignmentId, newStatus, meta = {}, user, supabase) {
    const localStore = loadLocalStore();
    const asg = localStore.assignments[assignmentId];
    if (!asg) {
      throw new Error(`Assignment with ID ${assignmentId} not found`);
    }

    const currentStatus = asg.status;
    const validNextStates = VALID_TRANSITIONS[currentStatus] || [];
    
    // Validate transition
    if (!validNextStates.includes(newStatus)) {
      throw new Error(`Invalid state transition: Cannot move assignment from ${currentStatus} to ${newStatus}. Allowed next states: ${validNextStates.join(', ') || 'None (Terminal state)'}`);
    }

    // Role verification
    const userRole = (user?.role || user?.user_metadata?.role || '').toLowerCase();
    const isOwner = asg.police_id && (asg.police_id === user?.id);
    const isAdmin = ['admin', 'traffic_operator'].includes(userRole);

    if (!isOwner && !isAdmin && !userRole.includes('ambulance')) {
      // Ambulances can record PASSED when crossing
      if (newStatus === 'PASSED' && (userRole.includes('ambulance') || userRole.includes('driver'))) {
        // permitted
      } else {
        const err = new Error(`Forbidden: You are not authorized to transition assignment ${assignmentId}`);
        err.statusCode = 403;
        throw err;
      }
    }

    const now = new Date().toISOString();
    asg.status = newStatus;
    asg.updated_at = now;

    if (meta.trafficCondition) asg.traffic_condition = meta.trafficCondition;
    if (meta.notes) asg.notes = meta.notes;
    if (meta.rejectionReason) asg.rejection_reason = meta.rejectionReason;
    if (meta.blockageDetails) asg.blockage_details = meta.blockageDetails;

    // Timestamps
    if (newStatus === 'ACKNOWLEDGED') asg.acknowledged_at = now;
    if (newStatus === 'READY') asg.ready_at = now;
    if (newStatus === 'CLEARANCE_CONFIRMED') asg.cleared_at = now;
    if (newStatus === 'PASSED') asg.passed_at = now;
    if (newStatus === 'COMPLETED') asg.completed_at = now;

    // Update plan cleared count
    const plan = localStore.plans[asg.plan_id];
    if (plan) {
      const planAsgs = Object.values(localStore.assignments).filter(a => a.plan_id === asg.plan_id);
      plan.cleared_junctions = planAsgs.filter(a => ['CLEARANCE_CONFIRMED', 'PASSED', 'COMPLETED'].includes(a.status)).length;
      plan.updated_at = now;
    }

    // Record audit log
    const auditEntry = {
      id: crypto.randomUUID(),
      assignment_id: assignmentId,
      incident_id: asg.incident_id,
      from_status: currentStatus,
      to_status: newStatus,
      changed_by: user?.id || null,
      changed_by_name: user?.user_metadata?.full_name || user?.email || 'Officer',
      actor_role: userRole || 'police',
      reason: meta.reason || meta.rejectionReason || meta.blockageDetails || `Status transitioned to ${newStatus}`,
      created_at: now
    };
    localStore.auditLogs.unshift(auditEntry);
    saveLocalStore(localStore);

    // Sync to Supabase
    if (supabase) {
      try {
        await supabase
          .from('police_route_assignments')
          .update({
            status: asg.status,
            traffic_condition: asg.traffic_condition,
            acknowledged_at: asg.acknowledged_at,
            ready_at: asg.ready_at,
            cleared_at: asg.cleared_at,
            passed_at: asg.passed_at,
            completed_at: asg.completed_at,
            rejection_reason: asg.rejection_reason,
            notes: asg.notes,
            updated_at: now
          })
          .eq('id', assignmentId);

        await supabase.from('police_assignment_audit_logs').insert(auditEntry);
      } catch (syncErr) {
        console.warn('[Police Engine] Supabase update warning:', syncErr.message);
      }
    }

    return {
      success: true,
      assignment: asg,
      auditEntry
    };
  },

  /**
   * Dynamic Route Replanning: Compares old and new route, preserves shared junctions,
   * cancels obsolete ones, and creates new ones with updated route version.
   */
  async replanRoute(incidentId, newRouteParams, user, supabase) {
    const localStore = loadLocalStore();
    const existingPlans = Object.values(localStore.plans)
      .filter(p => p.incident_id === incidentId)
      .sort((a, b) => b.route_version - a.route_version);

    const currentPlan = existingPlans[0] || null;
    const newVersion = currentPlan ? currentPlan.route_version + 1 : 1;
    const polyline = newRouteParams.routePolyline || newRouteParams.newRoutePolyline || newRouteParams.newRouteGeometry;

    // Generate new plan
    const result = await this.generateCoordinationPlan({
      ...newRouteParams,
      routePolyline: polyline,
      incidentId,
      routeVersion: newVersion
    }, user, supabase);

    if (currentPlan) {
      // Mark previous plan as SUPERSEDED
      currentPlan.status = 'SUPERSEDED';
      currentPlan.updated_at = new Date().toISOString();

      // Check which old assignments are not in new plan and cancel them
      const oldAsgs = Object.values(localStore.assignments).filter(a => a.plan_id === currentPlan.id);
      const newJuncNames = new Set(result.assignments.map(a => a.junction_name));

      for (const oldAsg of oldAsgs) {
        if (!newJuncNames.has(oldAsg.junction_name)) {
          if (!['COMPLETED', 'CANCELLED'].includes(oldAsg.status)) {
            oldAsg.status = 'CANCELLED';
            oldAsg.notes = `Superseded by Route Version ${newVersion}`;
            oldAsg.updated_at = new Date().toISOString();

            localStore.auditLogs.unshift({
              id: crypto.randomUUID(),
              assignment_id: oldAsg.id,
              incident_id: incidentId,
              from_status: oldAsg.status,
              to_status: 'CANCELLED',
              changed_by: user?.id || null,
              changed_by_name: 'Dynamic Replanning Engine',
              actor_role: 'system',
              reason: `Route deviated. Junction no longer on active corridor.`,
              created_at: new Date().toISOString()
            });
          }
        }
      }

      saveLocalStore(localStore);
    }

    return result;
  },

  /**
   * Reassigns an officer to a specific checkpoint (Dispatcher Override)
   */
  async reassignOfficer(assignmentId, policeId, policeName, reason, user, supabase) {
    if (!assignmentId) throw new Error('assignmentId is required');
    if (!policeId) throw new Error('policeId is required for reassignment');

    const localStore = loadLocalStore();
    const asg = localStore.assignments[assignmentId];
    if (!asg) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    const prevPoliceId = asg.police_id;
    asg.police_id = policeId;
    asg.police_name = policeName || 'Assigned Officer';
    asg.status = 'NOTIFIED';
    asg.is_reinforcement = true;
    asg.notification_sent_at = new Date().toISOString();
    asg.updated_at = new Date().toISOString();

    const auditEntry = {
      id: crypto.randomUUID(),
      assignment_id: assignmentId,
      incident_id: asg.incident_id,
      from_status: asg.status,
      to_status: 'NOTIFIED',
      changed_by: user?.id || 'admin-dispatcher',
      changed_by_name: user?.user_metadata?.full_name || 'Emergency Dispatcher',
      actor_role: 'admin',
      reason: reason || `Dispatcher reassigned unit from ${prevPoliceId || 'None'} to ${policeId}`,
      created_at: new Date().toISOString()
    };
    localStore.auditLogs.unshift(auditEntry);
    saveLocalStore(localStore);

    if (supabase) {
      try {
        await supabase.from('police_route_assignments').update({
          police_id: policeId,
          police_name: asg.police_name,
          status: 'NOTIFIED',
          is_reinforcement: true,
          updated_at: asg.updated_at
        }).eq('id', assignmentId);

        await supabase.from('police_assignment_audit_logs').insert(auditEntry);
      } catch (err) {
        console.warn('[Police Engine] Supabase update warning in reassignOfficer:', err.message);
      }
    }

    return { success: true, assignment: asg, auditEntry };
  },

  /**
   * Retrieves active coordination plan & assignments for an incident
   */
  getIncidentPlan(incidentId) {
    const localStore = loadLocalStore();
    const plans = Object.values(localStore.plans)
      .filter(p => p.incident_id === incidentId)
      .sort((a, b) => b.route_version - a.route_version);

    if (plans.length === 0) return null;
    const activePlan = plans.find(p => p.status === 'ACTIVE') || plans[0];

    const assignments = Object.values(localStore.assignments)
      .filter(a => a.plan_id === activePlan.id)
      .sort((a, b) => a.sequence_order - b.sequence_order);

    return {
      plan: activePlan,
      assignments,
      auditHistory: localStore.auditLogs.filter(l => l.incident_id === incidentId)
    };
  },

  /**
   * Retrieves assigned incidents and assignments for a specific police officer
   */
  getOfficerAssignments(policeId) {
    const localStore = loadLocalStore();
    const assignments = Object.values(localStore.assignments)
      .filter(a => a.police_id === policeId && !['COMPLETED', 'CANCELLED'].includes(a.status))
      .sort((a, b) => new Date(a.estimated_ambulance_arrival).getTime() - new Date(b.estimated_ambulance_arrival).getTime());

    return assignments;
  },

  /**
   * Admin overview of all active plans, coverage gaps, and resource conflicts
   */
  getAdminOverview() {
    const localStore = loadLocalStore();
    const activePlans = Object.values(localStore.plans).filter(p => p.status === 'ACTIVE');
    const allAssignments = Object.values(localStore.assignments);

    const coverageGaps = allAssignments.filter(a => a.status === 'PROPOSED' && !a.police_id);
    const unacknowledged = allAssignments.filter(a => a.status === 'NOTIFIED');
    const activeClearances = allAssignments.filter(a => a.status === 'CLEARANCE_CONFIRMED');

    return {
      totalActivePlans: activePlans.length,
      activePlans,
      coverageGaps,
      unacknowledgedAlerts: unacknowledged,
      activeClearances,
      totalAuditEntries: localStore.auditLogs.length,
      availableOfficers: AVAILABLE_REINFORCEMENT_OFFICERS.map(o => ({
        id: o.policeId,
        policeId: o.policeId,
        name: o.name,
        station: o.stationName,
        availability: 'AVAILABLE'
      }))
    };
  }
};
