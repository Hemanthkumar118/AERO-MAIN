import { supabase } from '../lib/supabase';
import type {
  Emergency,
  AvailabilityStatus,
  Junction,
  JunctionStatus,
  PoliceCoordinationMessage,
  TrafficIncident,
} from '../types';

export const policeService = {
  async getPoliceState(policeId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', policeId)
      .single();
    if (error || !data) {
      return {
        id: policeId,
        name: 'Traffic Control',
        badgeNumber: 'TC-00',
        station: 'HQ',
        availability: 'AVAILABLE' as AvailabilityStatus,
        location: [17.44, 78.34] as [number, number],
      };
    }
    return {
      id: data.id,
      name: data.full_name || 'Traffic Control',
      badgeNumber: data.badge_number || 'TC-00',
      station: data.station_name || 'HQ',
      availability: 'AVAILABLE' as AvailabilityStatus,
      location: [17.44, 78.34] as [number, number], // For real, it might read location telemetry
    };
  },

  async setAvailability(_policeId: string, status: AvailabilityStatus) {
    // A real implementation would update the officer's status in DB
    return { success: true, status };
  },

  async getIncomingEmergencies(): Promise<Emergency[]> {
    const { data, error } = await supabase
      .from('emergency_incidents')
      .select('*')
      .eq('status', 'active')
      .is('police_acknowledged_at', null);
      
    if (error) return [];
    return data.map(this.mapDbIncidentToEmergency);
  },

  async getActiveEmergencies(): Promise<Emergency[]> {
    const { data, error } = await supabase
      .from('emergency_incidents')
      .select('*')
      .in('status', ['active', 'dispatched', 'en_route']);
    if (error) return [];
    return data.map(this.mapDbIncidentToEmergency);
  },

  async getEmergencyDetails(id: string): Promise<Emergency | undefined> {
    const { data, error } = await supabase
      .from('emergency_incidents')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) return undefined;
    return this.mapDbIncidentToEmergency(data);
  },

  async acceptEmergency(emergencyId: string, policeId: string) {
    const { error } = await supabase
      .from('emergency_incidents')
      .update({ 
        police_acknowledged_at: new Date().toISOString(),
        police_id: policeId
      })
      .eq('id', emergencyId);
    if (error) throw new Error(`Failed to accept: ${error.message}`);
    return { success: true };
  },

  async markActive(_emergencyId: string) {
    // If we want to change status to active (it usually starts as active)
    return { success: true };
  },

  async completeEmergency(emergencyId: string) {
    const { error } = await supabase.from('emergency_incidents').update({ status: 'resolved' }).eq('id', emergencyId);
    if (error) throw new Error(`Failed to complete: ${error.message}`);
    return { success: true };
  },

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

  async sendCoordinationMessage(
    emergencyId: string,
    fromOfficerId: string,
    toJunctionId: string,
    message: string
  ): Promise<PoliceCoordinationMessage> {
    // Placeholder - would insert into a DB table in real life
    return {
      id: `MSG-${Date.now()}`,
      emergencyId,
      fromOfficerId,
      fromOfficerName: 'Officer',
      toJunctionId,
      toJunctionName: 'Junction',
      message,
      timestamp: new Date().toLocaleTimeString(),
    };
  },

  async getCoordinationMessages(): Promise<PoliceCoordinationMessage[]> {
    return [];
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
  
  mapDbIncidentToEmergency(i: any): Emergency {
    return {
      id: i.id,
      status: i.status === 'active' ? 'ACTIVE' : i.status === 'resolved' ? 'COMPLETED' : 'PENDING',
      priority: i.priority || 'CODE_RED',
      ambulanceId: i.ambulance_id || 'AMB-1',
      ambulanceDisplayName: i.ambulance_id || 'AERO ALS',
      hospital: { id: '', name: i.destination_hospital, address: '', location: { latitude: 0, longitude: 0 }, emergencyCapable: true },
      patient: {
        name: 'Emergency Patient',
        category: 'CARDIAC',
        priority: i.priority || 'CODE_RED',
        chiefComplaint: i.description || 'Incoming Emergency',
        vitals: { heartRate: 112, bloodPressure: '138/88', spo2: 96, respiratoryRate: 20, gcsScore: 15 }
      },
      currentSpeedKmH: i.current_speed || 50,
      route: {
        etaSeconds: i.route_duration_seconds || 300,
        trafficAwareEtaSeconds: i.traffic_duration_seconds,
        trafficStatus: i.traffic_status as any,
        polyline: i.route_geometry || [],
        distanceMeters: i.route_distance_meters || 0
      },
      vehicleNumber: i.ambulance_id || 'AMB-1',
      createdAt: i.created_at
    } as any;
  }
};
