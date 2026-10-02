import { supabase } from '../lib/supabase';
import type { Emergency, Hospital, HospitalPreparationState } from '../types';

export const hospitalService = {
  async getHospitalState(hospitalId: string): Promise<Hospital | null> {
    const { data, error } = await supabase
      .from('hospitals')
      .select('*')
      .eq('id', hospitalId)
      .single();
    if (error || !data) return null;
    return {
      id: data.id,
      name: data.name,
      address: data.address || '',
      location: (data.location && data.location.coordinates) ? { latitude: data.location.coordinates[1], longitude: data.location.coordinates[0] } : { latitude: 0, longitude: 0 },
      phone: data.phone,
      emergencyCapable: data.emergency_capable,
      totalBeds: data.total_beds,
      availableIcuBeds: data.available_icu_beds,
      traumaBaysAvailable: data.trauma_bays_available,
    };
  },

  async getHospitalByName(hospitalName: string): Promise<Hospital | null> {
    const { data, error } = await supabase
      .from('hospitals')
      .select('*')
      .eq('name', hospitalName)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id,
      name: data.name,
      address: data.address || '',
      location: (data.location && data.location.coordinates) ? { latitude: data.location.coordinates[1], longitude: data.location.coordinates[0] } : { latitude: 0, longitude: 0 },
      phone: data.phone,
      emergencyCapable: data.emergency_capable,
      totalBeds: data.total_beds,
      availableIcuBeds: data.available_icu_beds,
      traumaBaysAvailable: data.trauma_bays_available,
    };
  },

  async getAllHospitals(): Promise<Hospital[]> {
    const { data, error } = await supabase.from('hospitals').select('*');
    if (error) return [];
    return data.map((h: any) => ({
      id: h.id,
      name: h.name,
      address: h.address || '',
      location: (h.location && h.location.coordinates) ? { latitude: h.location.coordinates[1], longitude: h.location.coordinates[0] } : { latitude: 17.4485, longitude: 78.5303 },
      phone: h.phone,
      emergencyCapable: h.emergency_capable,
      totalBeds: h.total_beds,
      availableIcuBeds: h.available_icu_beds,
      traumaBaysAvailable: h.trauma_bays_available,
    }));
  },

  async getIncomingEmergencies(hospitalName?: string): Promise<Emergency[]> {
    // Ideally this should query emergency_incidents from Supabase.
    // Assuming Realtime provides the updates in HospitalDashboard, this can just fetch current ones.
    const query = supabase
      .from('emergency_incidents')
      .select('*')
      .in('status', ['active', 'dispatched', 'en_route']);
    
    if (hospitalName) {
      query.eq('destination_hospital', hospitalName);
    }
    
    const { data, error } = await query;
    if (error) return [];
    
    // We would map this to the Emergency type here
    return data.map((i: any) => ({
      id: i.id,
      status: 'ACTIVE',
      priority: i.priority || 'CODE_RED',
      ambulanceId: i.ambulance_id || 'UNAVAILABLE',
      ambulanceDisplayName: i.ambulance_id || 'AERO ALS',
      hospital: { id: '', name: i.destination_hospital, address: '', location: { latitude: 0, longitude: 0 }, emergencyCapable: true },
      patient: {
        name: 'Emergency Patient',
        category: 'CARDIAC',
        priority: i.priority || 'CODE_RED',
        chiefComplaint: 'Incoming Emergency',
        vitals: { heartRate: 112, bloodPressure: '138/88', spo2: 96, respiratoryRate: 20, gcsScore: 15 }
      },
      currentSpeedKmH: i.current_speed || 50,
      route: {
        etaSeconds: i.route_duration_seconds || 300,
        polyline: i.route_geometry || [],
        distanceMeters: i.route_distance_meters || 0
      },
      vehicleNumber: i.ambulance_id || 'UNAVAILABLE',
      createdAt: i.created_at
    } as any));
  },

  async updatePreparationState(_emergencyId: string, prepState: HospitalPreparationState) {
    // You'd typically save this in a specific table for hospital preps, or update the incident
    return { success: true, prepState };
  },

  async updateHospitalCapacity(hospitalId: string, capacities: { availableIcuBeds?: number, traumaBaysAvailable?: number }) {
    const updateData: any = {};
    if (capacities.availableIcuBeds !== undefined) updateData.available_icu_beds = capacities.availableIcuBeds;
    if (capacities.traumaBaysAvailable !== undefined) updateData.trauma_bays_available = capacities.traumaBaysAvailable;
    
    const { error } = await supabase.from('hospitals').update(updateData).eq('id', hospitalId);
    return !error;
  },

  async assignLeadDoctor(_emergencyId: string, doctorName: string) {
    return { success: true, doctorName };
  },

  async acknowledgeEmergency(emergencyId: string) {
    const { error } = await supabase
      .from('emergency_incidents')
      .update({ hospital_status: 'READY' })
      .eq('id', emergencyId);
    
    return !error;
  }
};

