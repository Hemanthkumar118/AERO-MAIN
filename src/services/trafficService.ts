import { supabase } from '../lib/supabase';
import type { Junction, TrafficIncident, TomTomIncident, CongestionSegment, JunctionStatus } from '../types';

export const trafficService = {
  async getJunctions(): Promise<Junction[]> {
    const { data, error } = await supabase.from('junctions').select('*');
    if (error) return [];
    return data.map((j: any) => ({
      id: j.id,
      name: j.name,
      location: j.location ? { latitude: j.location.coordinates[1], longitude: j.location.coordinates[0] } : { latitude: 0, longitude: 0 },
      status: j.status as JunctionStatus,
      assignedPoliceId: j.assigned_police_id,
    }));
  },

  async updateJunctionStatus(junctionId: string, status: JunctionStatus) {
    const { error } = await supabase.from('junctions').update({ status }).eq('id', junctionId);
    if (error) throw new Error(`Failed to update junction: ${error.message}`);
    return { success: true, junctionId, status };
  },

  async getIncidents(): Promise<TrafficIncident[]> {
    const { data, error } = await supabase.from('traffic_incidents').select('*');
    if (error) return [];
    return data.map((i: any) => ({
      id: i.id,
      type: i.type,
      severity: i.severity,
      title: i.title,
      description: i.description || '',
      location: i.location ? { latitude: i.location.coordinates[1], longitude: i.location.coordinates[0] } : { latitude: 0, longitude: 0 },
      reportedBy: i.reported_by,
      reportedAt: i.created_at,
      active: i.active
    }));
  },

  async reportIncident(incident: Omit<TrafficIncident, 'id' | 'reportedAt' | 'active'>): Promise<TrafficIncident> {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    const { data, error } = await supabase.from('traffic_incidents').insert({
      type: incident.type,
      severity: incident.severity,
      title: incident.title,
      description: incident.description,
      location: `POINT(${incident.location.longitude} ${incident.location.latitude})`,
      reported_by: userId,
      active: true,
    }).select().single();
    
    if (error || !data) throw new Error("Failed to report traffic incident");
    return {
      ...incident,
      id: data.id,
      reportedAt: data.created_at,
      active: data.active
    };
  },

  async getCongestionLayers(): Promise<CongestionSegment[]> {
    // AERO - "If no provider is configured: show: Traffic data unavailable rather than fake traffic."
    // We will return an empty array and the UI should handle lack of data appropriately.
    return [];
  },

  /**
   * Fetch real live TomTom traffic incidents via backend proxy
   */
  async getTomTomIncidents(params?: { lat?: number; lng?: number; radiusKm?: number; bbox?: string }): Promise<TomTomIncident[]> {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      let url = `${backendUrl}/api/traffic/incidents`;
      const queryParts: string[] = [];
      if (params?.bbox) {
        queryParts.push(`bbox=${encodeURIComponent(params.bbox)}`);
      } else if (params?.lat != null && params?.lng != null) {
        queryParts.push(`lat=${params.lat}`);
        queryParts.push(`lng=${params.lng}`);
        queryParts.push(`radiusKm=${params.radiusKm || 15}`);
      }
      if (queryParts.length > 0) {
        url += `?${queryParts.join('&')}`;
      }
      const response = await fetch(url);
      if (!response.ok) {
        console.warn('[trafficService] Failed to fetch TomTom incidents:', response.status);
        return [];
      }
      const data = await response.json();
      return (data.incidents || []) as TomTomIncident[];
    } catch (err) {
      console.warn('[trafficService] Error fetching TomTom incidents:', err);
      return [];
    }
  },
};
