import { supabase } from '../lib/supabase';
import { realtimeService } from './realtimeService';

import { TrafficAwareRoutingProvider } from './TrafficAwareRoutingProvider';
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

  async requestSOS(
    ambulanceId: string,
    hospital: Hospital,
    patientData?: Partial<PatientInfo>,
    currentPos?: [number, number],
  ): Promise<Emergency> {
    const ambulance = await this.getAmbulanceState(ambulanceId);
    const startPos = currentPos || ambulance.position;
    
    if (!currentPos || isNaN(currentPos[0]) || isNaN(currentPos[1])) {
      throw new Error("Live GPS location is missing or inaccurate. Cannot activate SOS corridor without fresh coordinates.");
    }

    // Compute live driving route from current GPS to chosen hospital
    const routeInfo = await TrafficAwareRoutingProvider.getFastestRoute(startPos as [number, number], [
      hospital.location.latitude,
      hospital.location.longitude,
    ]);

    if (!routeInfo.polyline || routeInfo.polyline.length === 0) {
      throw new Error("Unable to calculate route to the selected hospital.");
    }

    const newEmergency: Emergency = {
      id: '',
      status: 'ACTIVE',
      priority: patientData?.priority || 'CODE_RED',
      category: patientData?.category || 'CARDIAC',
      ambulanceId: ambulance.id,
      ambulanceDisplayName: ambulance.name,
      vehicleNumber: ambulance.vehicleNumber,
      driverName: ambulance.driverName,
      driverPhone: ambulance.driverPhone,
      hospital,
      currentSpeedKmH: 0,
      distanceCoveredKm: 0,
      createdAt: new Date().toISOString(),
      route: {
        polyline: routeInfo.polyline,
        distanceMeters: routeInfo.distanceMeters,
        etaSeconds: routeInfo.etaSeconds,
        steps: routeInfo.steps,
        junctions: realtimeService.getJunctions(),
        congestionSegments: routeInfo.congestionSegments,
      },
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

    // Supabase Persistence
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      throw new Error("Authentication required. Please log in as an ambulance operator to activate SOS.");
    }
    const userId = session.user.id;

    const priorityMapping: Record<string, string> = {
      'CODE_RED': 'critical',
      'CODE_YELLOW': 'high',
      'CODE_GREEN': 'medium',
    };
    const pgPriority = priorityMapping[newEmergency.priority as string] || 'critical';
    
    // 14. DUPLICATE SOS PROTECTION: Check if ambulance already has an active emergency
    const { data: existingActive } = await supabase.from('emergency_incidents')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['active', 'dispatched', 'en_route', 'arrived', 'rerouting'])
      .maybeSingle();
      
    if (existingActive) {
      throw new Error("EMERGENCY ALREADY ACTIVE: Please complete or cancel your current emergency before starting a new one.");
    }

    const { data, error } = await supabase.from('emergency_incidents').insert({
      user_id: userId,
      incident_type: newEmergency.category,
      priority: pgPriority,
      status: 'active',
      ambulance_id: ambulance.vehicleNumber || ambulance.name,
      latitude: startPos[0],
      longitude: startPos[1],
      destination_hospital: hospital.name,
      destination_latitude: hospital.location.latitude,
      destination_longitude: hospital.location.longitude,
      eta_minutes: Math.round(routeInfo.etaSeconds / 60),
      route_geometry: routeInfo.polyline,
      route_distance_meters: routeInfo.distanceMeters,
      route_duration_seconds: routeInfo.etaSeconds,
      traffic_duration_seconds: routeInfo.trafficAwareEtaSeconds || routeInfo.etaSeconds,
      traffic_status: routeInfo.trafficStatus || 'UNAVAILABLE',
      route_version: 1,
      current_latitude: startPos[0],
      current_longitude: startPos[1],
      current_speed: 0,
      description: newEmergency.patient?.chiefComplaint || 'Emergency Request'
    }).select().single();
    
    if (error || !data) {
      console.error('Supabase insert failed:', error);
      if (error?.message?.includes('schema cache') || error?.code === 'PGRST204') {
        throw new Error(`DATABASE CONFIGURATION ERROR: Schema mismatch. Please run "NOTIFY pgrst, 'reload schema';" in Supabase SQL Editor. Details: ${error?.message}`);
      }
      throw new Error(`Failed to create emergency incident: ${error?.message}`);
    }

    // Map the real DB ID back
    newEmergency.id = data.id;
    return newEmergency;
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
