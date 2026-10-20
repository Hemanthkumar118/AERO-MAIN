import type { Emergency } from '../types';

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

export const analyticsService = {
  async getDashboardOverview(): Promise<AdminOverviewStats> {
    try {
      const res = await fetch('/api/admin/overview');
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
      const res = await fetch('/api/admin/analytics');
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

      const res = await fetch(`/api/admin/incidents?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success && json.incidents) {
        return json.incidents.map((i: any) => ({
          id: i.id,
          status: ['active', 'dispatched', 'en_route', 'rerouting', 'arrived'].includes(i.status) ? 'ACTIVE' : (i.status === 'resolved' || i.status === 'completed' ? 'COMPLETED' : 'CANCELLED'),
          rawStatus: i.status,
          priority: (i.priority || 'CODE_RED').toUpperCase(),
          ambulanceDisplayName: i.ambulance_id || 'Ambulance Unit',
          vehicleNumber: i.ambulance_id || 'AERO Unit',
          hospital: {
            id: 'hosp',
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
          currentSpeedKmH: i.current_speed,
          corridorStatus: i.corridor_status,
          hospitalStatus: i.hospital_status,
          route: {
            etaSeconds: i.traffic_duration_seconds || i.route_duration_seconds,
            distanceMeters: i.route_distance_meters,
            trafficStatus: i.traffic_status
          }
        })) as any;
      }
    } catch (err) {
      console.warn('[analyticsService] Failed to query incident history:', err);
    }
    return [];
  },

  async exportData(format: 'csv' | 'json') {
    try {
      const res = await fetch('/api/admin/incidents?limit=500');
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
        const headers = ['ID', 'Status', 'Incident Type', 'Priority', 'Ambulance ID', 'Destination Hospital', 'Corridor Status', 'Hospital Status', 'Created At', 'Resolved At'];
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
        content = [headers.join(','), ...rows.map((row: string[]) => row.join(','))].join('\n');
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
