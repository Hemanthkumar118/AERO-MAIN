import { supabase } from '../lib/supabase';
import { getBackendUrl } from './apiConfig';

import type { Emergency, Hospital, PatientInfo, TrafficIncident, RouteInfo } from '../types';

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
    route?: RouteInfo | null,
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

    const insertPayload: any = {
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
    };

    if (route && route.polyline && route.polyline.length > 0) {
      insertPayload.route_geometry = route.polyline;
      insertPayload.route_distance_meters = route.distanceMeters;
      insertPayload.route_duration_seconds = route.etaSeconds;
      insertPayload.traffic_duration_seconds = route.trafficAwareEtaSeconds || route.etaSeconds;
      insertPayload.traffic_status = route.trafficStatus || (route.isTrafficAware ? 'LIVE' : 'UNAVAILABLE');
      if (route.routeProvider) {
        insertPayload.route_provider = route.routeProvider;
      } else {
        insertPayload.route_provider = 'tomtom';
      }
      insertPayload.route_version = 1;
      insertPayload.route_updated_at = route.calculatedAt || new Date().toISOString();
    }

    // 1. Primary insert attempt
    let { data, error } = await supabase.from('emergency_incidents').insert(insertPayload).select().single();
    
    // 2. Resilient fallback: If route_provider is not in the schema cache, retry without it
    if (error && (error.code === 'PGRST204' || error.message?.includes('route_provider') || (error as any).details?.includes('route_provider'))) {
      console.warn('[AERO SOS] route_provider column not found in schema cache. Retrying insert without route_provider...');
      delete insertPayload.route_provider;
      const retryResult = await supabase.from('emergency_incidents').insert(insertPayload).select().single();
      data = retryResult.data;
      error = retryResult.error;
    }

    // 3. Safety fallback: If any other optional route metadata failed in schema cache, fallback to core payload
    if (error && (error.code === 'PGRST204' || error.message?.includes('schema cache') || error.code === '42703')) {
      console.warn('[AERO SOS] Optional route metadata schema mismatch. Retrying with essential emergency payload to protect patient transport...', error);
      const corePayload: any = {
        user_id: userId,
        incident_type: insertPayload.incident_type,
        priority: insertPayload.priority,
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
        description: insertPayload.description,
      };
      if (route?.polyline?.length) {
        corePayload.route_geometry = route.polyline;
      }
      const coreResult = await supabase.from('emergency_incidents').insert(corePayload).select().single();
      data = coreResult.data;
      error = coreResult.error;
    }

    if (error || !data) {
      console.error('Supabase insert failed:', error);
      const sanitizedMsg = error?.message?.replace(/https?:\/\/[^\s]+/g, '[redacted]') || 'Database insert failed';
      throw new Error(`Failed to create emergency incident: ${sanitizedMsg}`);
    }

    // Sync authoritative incident to Express backend
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${getBackendUrl()}/api/incidents/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(data)
      });
    } catch (syncErr) {
      console.warn('[ambulanceService] Backend incident sync notice:', syncErr);
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
        name: patientData?.name,
        age: patientData?.age,
        gender: patientData?.gender,
        category: patientData?.category || 'CARDIAC',
        priority: patientData?.priority || 'CODE_RED',
        chiefComplaint: patientData?.chiefComplaint || 'Emergency Request',
        vitals: patientData?.vitals,
        paramedicNotes: patientData?.paramedicNotes,
        leadDoctorAssigned: undefined,
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
    const now = new Date().toISOString();
    const { error } = await supabase.from('emergency_incidents').update({ status: 'cancelled', resolved_at: now }).eq('id', emergencyId);
    if (error) throw new Error(`Failed to cancel SOS: ${error.message}`);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${getBackendUrl()}/api/incidents/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({ id: emergencyId, status: 'cancelled', resolved_at: now })
      });
    } catch {}

    return { success: true };
  },

  async completeSOS(emergencyId: string) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('emergency_incidents').update({ status: 'resolved', resolved_at: now }).eq('id', emergencyId);
    if (error) throw new Error(`Failed to complete SOS: ${error.message}`);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${getBackendUrl()}/api/incidents/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({ id: emergencyId, status: 'resolved', resolved_at: now })
      });
    } catch {}

    return { success: true };
  },

  /**
   * Authoritative arrival transition:
   * Calls the server endpoint to atomically persist arrival, set server arrived_at,
   * close police route coordination, and broadcast to all dashboards.
   */
  async markArrived(emergencyId: string, notes?: string): Promise<{ success: boolean; incident: any; arrivedAt: string }> {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    // 1. Authoritative Backend Endpoint Call
    try {
      const res = await fetch(`${getBackendUrl()}/api/incidents/${emergencyId}/arrival`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ notes })
      });

      if (res.ok) {
        const body = await res.json();
        if (body.success) {
          return {
            success: true,
            incident: body.incident,
            arrivedAt: body.arrivedAt || body.incident?.arrived_at || new Date().toISOString()
          };
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 403 || res.status === 400 || res.status === 404) {
          throw new Error(errJson.error || `Arrival failed with status ${res.status}`);
        }
      }
    } catch (apiErr: any) {
      if (apiErr.message?.includes('Forbidden') || apiErr.message?.includes('Illegal state transition') || apiErr.message?.includes('not found')) {
        throw apiErr;
      }
      console.warn('[AmbulanceService] Backend arrival endpoint notice, falling back to direct Supabase write:', apiErr.message);
    }

    // 2. Direct Supabase Fallback (client-only / offline resilience)
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('emergency_incidents')
      .update({
        status: 'arrived',
        arrived_at: now,
        current_speed: 0,
        route_duration_seconds: 0,
        traffic_duration_seconds: 0,
        corridor_status: 'COMPLETED',
        updated_at: now
      })
      .eq('id', emergencyId)
      .select()
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to record arrival in database: ${error.message}`);
    }

    return {
      success: true,
      incident: data || { id: emergencyId, status: 'arrived', arrived_at: now },
      arrivedAt: now
    };
  },
};
