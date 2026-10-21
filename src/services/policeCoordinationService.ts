import { supabase } from '../lib/supabase';

export type PoliceRouteAssignmentStatus =
  | 'PROPOSED'
  | 'NOTIFIED'
  | 'ACKNOWLEDGED'
  | 'EN_ROUTE_TO_POSITION'
  | 'READY'
  | 'CLEARANCE_CONFIRMED'
  | 'PASSED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'UNAVAILABLE'
  | 'NO_RESPONSE'
  | 'BLOCKED'
  | 'CLEARANCE_REVOKED'
  | 'CANCELLED'
  | 'REASSIGNED';

export type TrafficCondition = 'NORMAL' | 'MODERATE' | 'CONGESTED' | 'GRIDLOCK' | 'BLOCKED';

export interface PoliceRouteAssignment {
  id: string;
  plan_id: string;
  incident_id: string;
  police_id: string | null;
  police_name: string;
  badge_number: string;
  station_name: string;
  junction_id?: string;
  junction_name: string;
  junction_latitude: number;
  junction_longitude: number;
  sequence_order: number;
  route_station_meters: number;
  perpendicular_distance_meters: number;
  distance_from_ambulance_meters: number;
  ambulance_eta_seconds?: number;
  estimated_ambulance_arrival: string;
  status: PoliceRouteAssignmentStatus;
  is_reinforcement: boolean;
  is_coverage_gap?: boolean;
  traffic_condition: TrafficCondition;
  notification_sent_at?: string | null;
  acknowledged_at?: string | null;
  ready_at?: string | null;
  cleared_at?: string | null;
  passed_at?: string | null;
  completed_at?: string | null;
  rejection_reason?: string | null;
  blockage_details?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PoliceCoordinationPlan {
  id: string;
  incident_id: string;
  route_version: number;
  status: 'ACTIVE' | 'REPLANNING' | 'SUPERSEDED' | 'COMPLETED' | 'CANCELLED';
  total_junctions: number;
  cleared_junctions: number;
  coverage_gap_count: number;
  coverage_gaps_count?: number;
  route_distance_meters: number;
  route_duration_seconds: number;
  corridor_distance_meters: number;
  created_at: string;
  updated_at: string;
}

export interface PoliceAssignmentAuditLog {
  id: string;
  assignment_id: string;
  incident_id: string;
  from_status: string | null;
  to_status: string;
  changed_by?: string | null;
  changed_by_name?: string | null;
  actor_role: string;
  reason?: string | null;
  created_at: string;
}

export interface GeneratePlanParams {
  incidentId?: string;
  ambulanceId?: string;
  routePolyline?: [number, number][];
  routeGeometry?: [number, number][];
  newRoutePolyline?: [number, number][];
  newRouteGeometry?: [number, number][];
  newDestinationLocation?: [number, number];
  newDestinationHospital?: string;
  destinationLocation?: [number, number];
  destinationHospital?: string;
  routeDistanceMeters?: number;
  routeDurationSeconds?: number;
  ambulanceLocation?: [number, number];
  corridorDistanceMeters?: number;
  emergencyPriority?: string;
  priority?: string;
  reason?: string;
}
import { getBackendUrl } from './apiConfig';

const BACKEND_URL = getBackendUrl();

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    } else {
      headers['Authorization'] = 'Bearer mock-token-police';
    }
  } catch {
    headers['Authorization'] = 'Bearer mock-token-police';
  }

  return headers;
}

export const policeCoordinationService = {
  /**
   * Generates or recalculates a route-based coordination plan for an incident
   */
  async generatePlan(
    incidentIdOrParams: string | (GeneratePlanParams & { incidentId: string }),
    maybeParams?: GeneratePlanParams
  ): Promise<{
    success: boolean;
    plan: PoliceCoordinationPlan;
    assignments: PoliceRouteAssignment[];
    summary: any;
  }> {
    let incidentId: string;
    let params: GeneratePlanParams;

    if (typeof incidentIdOrParams === 'string') {
      incidentId = incidentIdOrParams;
      params = maybeParams || {};
    } else {
      incidentId = incidentIdOrParams.incidentId;
      params = incidentIdOrParams;
    }

    const headers = await getAuthHeaders();
    const res = await fetch(`${BACKEND_URL}/api/incidents/${incidentId}/coordination-plan`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to generate coordination plan');
    }
    return data;
  },

  /**
   * Retrieves active coordination plan and ordered assignments for an incident
   */
  async getPlan(incidentId: string): Promise<{
    plan: PoliceCoordinationPlan;
    assignments: PoliceRouteAssignment[];
    auditHistory: PoliceAssignmentAuditLog[];
  }> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${BACKENDURL_OR_DEFAULT()}/api/incidents/${incidentId}/coordination-plan`, {
      method: 'GET',
      headers
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch coordination plan');
    }
    return data;
  },

  /**
   * Get checkpoints assigned to the current or specified police officer
   */
  async getOfficerAssignments(policeId?: string): Promise<PoliceRouteAssignment[]> {
    const headers = await getAuthHeaders();
    const query = policeId ? `?policeId=${encodeURIComponent(policeId)}` : '';
    const res = await fetch(`${BACKENDURL_OR_DEFAULT()}/api/police/assignments${query}`, {
      method: 'GET',
      headers
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch officer assignments');
    }
    return data.assignments || [];
  },

  /**
   * Transition an assignment status through the safe state machine
   */
  async updateAssignmentStatus(
    assignmentId: string,
    status: PoliceRouteAssignmentStatus,
    meta: {
      trafficCondition?: TrafficCondition;
      reason?: string;
      rejectionReason?: string;
      blockageDetails?: string;
      notes?: string;
    } = {}
  ): Promise<{ success: boolean; assignment: PoliceRouteAssignment; auditEntry: PoliceAssignmentAuditLog }> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${BACKENDURL_OR_DEFAULT()}/api/police/assignments/${assignmentId}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status, ...meta })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update assignment status');
    }
    return data;
  },

  /**
   * Dynamic Route Replanning: Compares new route with old, retains shared, cancels removed,
   * discovers newly added junctions ahead.
   */
  async replanRoute(incidentId: string, params: GeneratePlanParams): Promise<{
    success: boolean;
    plan: PoliceCoordinationPlan;
    assignments: PoliceRouteAssignment[];
    summary: any;
  }> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${BACKENDURL_OR_DEFAULT()}/api/incidents/${incidentId}/replan-route`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to replan route coordination');
    }
    return data;
  },

  /**
   * Admin overview of all active plans, coverage gaps, and alerts
   */
  async getAdminOverview(): Promise<{
    totalActivePlans: number;
    activePlans: PoliceCoordinationPlan[];
    plans: (PoliceCoordinationPlan & { assignments: PoliceRouteAssignment[] })[];
    coverageGaps: PoliceRouteAssignment[];
    unacknowledgedAlerts: PoliceRouteAssignment[];
    activeClearances: PoliceRouteAssignment[];
    totalAuditEntries: number;
    totalCheckpoints: number;
    totalGaps: number;
    availableOfficers: any[];
  }> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${BACKENDURL_OR_DEFAULT()}/api/admin/coordination-overview`, {
      method: 'GET',
      headers
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch admin coordination overview');
    }
    return data;
  },

  /**
   * Dispatcher manual reassignment / override
   */
  async reassignOfficer(
    assignmentId: string,
    policeId: string,
    policeName?: string,
    reason?: string
  ): Promise<{ success: boolean; assignment: PoliceRouteAssignment }> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${BACKENDURL_OR_DEFAULT()}/api/admin/assignments/${assignmentId}/reassign`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ policeId, policeName, reason })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to reassign officer');
    }
    return data;
  }
};

function BACKENDURL_OR_DEFAULT(): string {
  return BACKEND_URL;
}
