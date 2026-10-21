import type { Emergency } from '../types';
import { supabase } from '../lib/supabase';
import { getBackendUrl } from './apiConfig';

export interface AdminOverviewStats {
  activeEmergencies: number;
  completedIncidents: number;
  cancelledIncidents: number;
  totalIncidents: number;
  onlineAmbulances: number;
  availablePolice: number;
  partnerHospitals: number;
  avgResponseTimeMins: number | null;
  corridorClearanceRatePercent: number | null;
  hasResponseTimeData: boolean;
  hasCorridorData: boolean;
  timestamp: string;
}

export interface AdminAnalyticsDataset {
  overview: AdminOverviewStats;
  categoryDistribution: { name: string; value: number }[];
  statusDistribution: { name: string; value: number }[];
  timelineVolume: { date: string; count: number; cleared: number }[];
  responseTimesList: {
    id: string;
    date: string;
    durationMinutes: number;
    estimatedEtaMinutes: number | null;
  }[];
  totalRecords: number;
  timestamp: string;
}

async function getAdminAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch {}
  return headers;
}

export const analyticsService = {
  async getDashboardOverview(): Promise<AdminOverviewStats> {
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch(`${getBackendUrl()}/api/admin/overview`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success && json.data) {
        return json.data;
      }
    } catch (err) {
      console.warn('[analyticsService] Failed to fetch overview, using fallback:', err);
    }
    return {
      activeEmergencies: 0,
      completedIncidents: 0,
      cancelledIncidents: 0,
      totalIncidents: 0,
      onlineAmbulances: 0,
      availablePolice: 0,
      partnerHospitals: 0,
      avgResponseTimeMins: null,
      corridorClearanceRatePercent: null,
      hasResponseTimeData: false,
      hasCorridorData: false,
      timestamp: new Date().toISOString()
    };
  },

  async getAnalyticsData(): Promise<AdminAnalyticsDataset> {
    try {
      const overview = await this.getDashboardOverview();
      const headers = await getAdminAuthHeaders();
      const res = await fetch(`${getBackendUrl()}/api/admin/analytics`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success && json.data) {
        return {
          overview,
          categoryDistribution: json.data.categoryDistribution || [],
          statusDistribution: json.data.statusDistribution || [],
          timelineVolume: json.data.timelineVolume || [],
          responseTimesList: json.data.responseTimesList || [],
          totalRecords: json.data.totalRecords || 0,
          timestamp: json.data.timestamp || new Date().toISOString()
        };
      }
    } catch (err) {
      console.warn('[analyticsService] Failed to fetch analytics dataset:', err);
    }
    const overview = await this.getDashboardOverview();
    return {
      overview,
      categoryDistribution: [],
      statusDistribution: [],
      timelineVolume: [],
      responseTimesList: [],
      totalRecords: 0,
      timestamp: new Date().toISOString()
    };
  },

  async getEmergencyHistory(statusFilter?: string, categoryFilter?: string, search?: string): Promise<Emergency[]> {
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter);
      if (categoryFilter && categoryFilter !== 'ALL') params.set('category', categoryFilter);
      if (search && search.trim()) params.set('search', search.trim());
      params.set('limit', '100');

      const headers = await getAdminAuthHeaders();
      const res = await fetch(`${getBackendUrl()}/api/admin/incidents?${params.toString()}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.incidents && Array.isArray(json.incidents)) {
        return json.incidents.map((i: any) => {
          const raw = (i.status || '').toLowerCase();
          const isArrived = raw === 'arrived';
          const isActive = ['active', 'dispatched', 'en_route', 'rerouting'].includes(raw);
          const isCompleted = ['resolved', 'completed'].includes(raw);
          const isCancelled = raw === 'cancelled';
          const canonicalStatus = isArrived ? 'ARRIVED' : (isActive ? 'ACTIVE' : (isCompleted ? 'COMPLETED' : (isCancelled ? 'CANCELLED' : 'ACTIVE')));

          return {
            id: i.id,
            status: canonicalStatus,
            rawStatus: i.status,
            priority: (i.priority || 'CODE_RED').toUpperCase(),
            ambulanceDisplayName: i.ambulance_id || 'Ambulance Unit',
            vehicleNumber: i.ambulance_id || 'AERO Unit',
            hospital: {
              id: '',
              name: i.destination_hospital || 'Not assigned',
              address: '',
              location: { latitude: i.destination_latitude || 0, longitude: i.destination_longitude || 0 },
              emergencyCapable: true,
            },
            patient: {
              category: i.incident_type || 'Unspecified',
              priority: (i.priority || 'CODE_RED').toUpperCase(),
              chiefComplaint: i.description || 'Emergency Dispatch'
            },
            createdAt: i.created_at,
            resolvedAt: i.resolved_at,
            arrivedAt: i.arrived_at,
            arrived_at: i.arrived_at,
            currentSpeedKmH: isArrived ? 0 : i.current_speed,
            corridorStatus: isArrived ? 'COMPLETED' : i.corridor_status,
            hospitalStatus: i.hospital_status,
            route: {
              etaSeconds: isArrived ? 0 : (i.traffic_duration_seconds || i.route_duration_seconds),
              distanceMeters: isArrived ? 0 : i.route_distance_meters,
              trafficStatus: i.traffic_status
            }
          };
        }) as any;
      }
    } catch (err) {
      console.warn('[analyticsService] Failed to query incident history:', err);
    }
    return [];
  },

  /**
   * Admin Superuser: Edit any incident property or status
   */
  async updateIncident(id: string, updates: Record<string, any>): Promise<{ success: boolean; incident: any }> {
    const headers = await getAdminAuthHeaders();
    const res = await fetch(`${getBackendUrl()}/api/admin/incidents/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(updates)
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || `Failed to update incident (${res.status})`);
    }
    return json;
  },

  /**
   * Admin Superuser: Nuke (purge/delete) a single incident
   */
  async nukeIncident(id: string): Promise<{ success: boolean; nukedId: string }> {
    const headers = await getAdminAuthHeaders();
    const res = await fetch(`${getBackendUrl()}/api/admin/incidents/${id}`, {
      method: 'DELETE',
      headers
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || `Failed to nuke incident (${res.status})`);
    }
    return json;
  },

  /**
   * Admin Superuser: Nuke all active incidents across the board
   */
  async nukeAllActiveIncidents(): Promise<{ success: boolean; message: string; nukedCount: number }> {
    const headers = await getAdminAuthHeaders();
    const res = await fetch(`${getBackendUrl()}/api/admin/incidents/nuke-all`, {
      method: 'POST',
      headers
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || `Failed to nuke active incidents (${res.status})`);
    }
    return json;
  },

  async exportData(format: 'csv' | 'json') {
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch(`${getBackendUrl()}/api/admin/incidents?limit=500`, { headers });
      const json = await res.json();
      const records = json.incidents || [];

      let content = '';
      let mimeType = 'text/plain';
      let filename = `aero_incidents_${new Date().toISOString().slice(0, 10)}`;

      if (format === 'json') {
        content = JSON.stringify(records, null, 2);
        mimeType = 'application/json';
        filename += '.json';
      } else {
        const headersList = ['ID', 'Status', 'Incident Type', 'Priority', 'Ambulance ID', 'Destination Hospital', 'Corridor Status', 'Hospital Status', 'Created At', 'Resolved At'];
        const rows = records.map((r: any) => [
          r.id,
          r.status,
          r.incident_type || '',
          r.priority || '',
          r.ambulance_id || '',
          `"${(r.destination_hospital || '').replace(/"/g, '""')}"`,
          r.corridor_status || '',
          r.hospital_status || '',
          r.created_at || '',
          r.resolved_at || ''
        ]);
        content = [headersList.join(','), ...rows.map((row: string[]) => row.join(','))].join('\n');
        mimeType = 'text/csv';
        filename += '.csv';
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[analyticsService] Export failed:', err);
    }
  },
};
