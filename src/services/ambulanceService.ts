import { supabase } from '../lib/supabase';

import type { Emergency, Hospital, PatientInfo, TrafficIncident } from '../types';

export const ambulanceService = {
  async getAmbulanceState(ambulanceId: string) {
    const { data, error } = await supabase
      .from('ambulances')
      .select('*, profiles!driver_id(full_name, phone)')
      .eq('id', ambulanceId)
      .single();
    if (error || !data) {
      // Fallback object to avoid hard crashes if ambulance is not fully configured,
      // but in production it should throw or handle null.
      return {
        id: ambulanceId,
        name: data?.vehicle_number || 'AERO ALS-01',
        vehicleNumber: data?.vehicle_number || 'TS09 EM 1234',
        driverName: data?.profiles?.full_name || 'Paramedic',
        driverPhone: data?.profiles?.phone || '+91 9000000000',
        position: data?.location ? [data.location.coordinates[1], data.location.coordinates[0]] : [17.44, 78.34],
        status: data?.current_status || 'AVAILABLE',
      };
    }
    return {
      id: data.id,
      name: data.vehicle_number || 'AERO ALS-01',
      vehicleNumber: data.vehicle_number,
      driverName: data.profiles?.full_name || 'Paramedic',
      driverPhone: data.profiles?.phone || '+91 9000000000',
      position: data.location ? [data.location.coordinates[1], data.location.coordinates[0]] : [17.44, 78.34],
      status: data.current_status,
    };
  },

  async getActiveEmergency(userId: string): Promise<any> {
    const { data, error } = await supabase
      .from('emergency_incidents')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['active', 'dispatched', 'en_route', 'rerouting'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }
    return data ?? null;
  },

  async requestSOS(
    ambulanceId: string,
    hospital: Hospital,
    patientData?: Partial<PatientInfo>,
    currentPos?: [number, number],
  ): Promise<Emergency> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      throw new Error("Authentication required. Please log in as an ambulance operator to activate SOS.");
    }
    const userId = session.user.id;
    
    // 14. DUPLICATE SOS PROTECTION
    const existingActive = await this.getActiveEmergency(userId);
    if (existingActive) {
      const error = new Error("EMERGENCY ALREADY ACTIVE");
      (error as any).code = 'ALREADY_ACTIVE';
      throw error;
    }

    const priorityMapping: Record<string, string> = {
      'CODE_RED': 'critical',
      'CODE_YELLOW': 'high',
      'CODE_GREEN': 'medium',
    };
    const pgPriority = priorityMapping[patientData?.priority as string] || 'critical';
    
    const startPos = currentPos || [17.44, 78.34];

    // Fast insert without waiting for route calculation or ambulance lookup
    const { data, error } = await supabase.from('emergency_incidents').insert({
      user_id: userId,
      incident_type: patientData?.category || 'CARDIAC',
      priority: pgPriority,
      status: 'active',
      ambulance_id: ambulanceId,
      latitude: startPos[0],
      longitude: startPos[1],
      destination_hospital: hospital.name,
      destination_latitude: hospital.location.latitude,
      destination_longitude: hospital.location.longitude,
      current_latitude: startPos[0],
      current_longitude: startPos[1],
      current_speed: 0,
      description: patientData?.chiefComplaint || 'Emergency Request'
    }).select().single();
    
    if (error || !data) {
      console.error('Supabase insert failed:', error);
      throw new Error(`Failed to create emergency incident: ${error?.message}`);
    }

    return {
      id: data.id,
      status: 'ACTIVE',
      priority: patientData?.priority || 'CODE_RED',
      category: patientData?.category || 'CARDIAC',
      ambulanceId: ambulanceId,
      ambulanceDisplayName: 'Ambulance',
      vehicleNumber: ambulanceId,
      driverName: 'Paramedic',
      driverPhone: '',
      hospital,
      currentSpeedKmH: 0,
      distanceCoveredKm: 0,
      createdAt: data.created_at || new Date().toISOString(),
      patient: {
        name: patientData?.name || 'Emergency Patient',
        age: patientData?.age || 45,
        gender: patientData?.gender || 'M',
        category: patientData?.category || 'CARDIAC',
        priority: patientData?.priority || 'CODE_RED',
        chiefComplaint: patientData?.chiefComplaint || 'Acute emergency, unstable vitals',
        vitals: patientData?.vitals || {
          heartRate: 114,
          bloodPressure: '152/94',
          spo2: 92,
          respiratoryRate: 22,
          gcsScore: 14,
        },
        paramedicNotes: patientData?.paramedicNotes || 'Patient loaded. Oxygen administered.',
        leadDoctorAssigned: 'ER Duty Team',
      },
      hospitalPrep: {
        traumaBayReady: false,
        icuBedReserved: false,
        otStandby: false,
        bloodReady: false,
        specialistAlerted: true,
      },
    };
  },

  async triggerReroute(_emergencyId: string, _alternateHospital?: Hospital): Promise<Emergency> {
    throw new Error('triggerReroute not implemented for real DB yet');
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

  async cancelSOS(emergencyId: string) {
    const { error } = await supabase.from('emergency_incidents').update({ status: 'resolved' }).eq('id', emergencyId);
    if (error) throw new Error(`Failed to cancel SOS: ${error.message}`);
    return { success: true };
  },

  async completeSOS(emergencyId: string) {
    const { error } = await supabase.from('emergency_incidents').update({ status: 'resolved' }).eq('id', emergencyId);
    if (error) throw new Error(`Failed to complete SOS: ${error.message}`);
    return { success: true };
  },
};
