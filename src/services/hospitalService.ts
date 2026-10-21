import { supabase } from '../lib/supabase';
import type { 
  Emergency, 
  Hospital, 
  HospitalReadinessState, 
  ReadinessTaskStatus, 
  EmergencyPriority, 
  EmergencyCategory,
  PatientInfo
} from '../types';
import { getBackendUrl } from './apiConfig';

const API_BASE_URL = getBackendUrl();

function mapPriority(pgPriority?: string): EmergencyPriority {
  switch ((pgPriority || '').toLowerCase()) {
    case 'critical':
    case 'code_red':
      return 'CODE_RED';
    case 'high':
    case 'code_amber':
      return 'CODE_AMBER';
    case 'medium':
    case 'code_yellow':
      return 'CODE_YELLOW';
    default:
      return 'CODE_RED';
  }
}

export function parsePatientData(raw: any): PatientInfo {
  let parsedDescription: any = null;
  if (typeof raw.description === 'string' && raw.description.startsWith('{')) {
    try {
      parsedDescription = JSON.parse(raw.description);
    } catch {
      parsedDescription = null;
    }
  }

  const category: EmergencyCategory = (raw.incident_type as EmergencyCategory) || 'GENERAL';
  const priority: EmergencyPriority = mapPriority(raw.priority);
  const chiefComplaint = parsedDescription?.chiefComplaint || raw.description || undefined;

  const age = raw.patient_age != null 
    ? Number(raw.patient_age) 
    : (parsedDescription?.age != null ? Number(parsedDescription.age) : undefined);

  const gender = raw.patient_gender || parsedDescription?.gender || undefined;
  const name = raw.patient_name || parsedDescription?.name || undefined;

  // Real vitals parsing — strictly undefined if not transmitted
  let vitals = undefined;
  if (raw.vitals && typeof raw.vitals === 'object') {
    vitals = raw.vitals;
  } else if (parsedDescription?.vitals && typeof parsedDescription.vitals === 'object') {
    vitals = parsedDescription.vitals;
  }

  return {
    name,
    age,
    gender,
    category,
    priority,
    chiefComplaint,
    vitals,
    paramedicNotes: parsedDescription?.paramedicNotes || undefined,
    leadDoctorAssigned: raw.assigned_doctor || parsedDescription?.leadDoctorAssigned || undefined,
    leadDoctorSpecialty: parsedDescription?.leadDoctorSpecialty || undefined,
    leadDoctorContact: parsedDescription?.leadDoctorContact || undefined
  };
}

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
    try {
      const res = await fetch(`${API_BASE_URL}/api/hospital/list`);
      if (res.ok) {
        const body = await res.json();
        if (body.success && Array.isArray(body.hospitals) && body.hospitals.length > 0) {
          return body.hospitals;
        }
      }
    } catch {
      // Fallback directly to Supabase client
    }

    const { data, error } = await supabase.from('hospitals').select('*');
    if (error || !data) return [];
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
    const query = supabase
      .from('emergency_incidents')
      .select('*')
      .in('status', ['active', 'dispatched', 'en_route', 'rerouting', 'arrived'])
      .order('created_at', { ascending: false });
    
    if (hospitalName) {
      query.eq('destination_hospital', hospitalName);
    }
    
    const { data, error } = await query;
    if (error || !data) return [];
    
    return data.map((i: any) => {
      const isArrived = (i.status || '').toLowerCase() === 'arrived';
      return {
        id: i.id,
        status: (i.status || 'active').toUpperCase(),
        priority: mapPriority(i.priority),
        category: (i.incident_type as EmergencyCategory) || 'GENERAL',
        ambulanceId: i.ambulance_id || 'UNAVAILABLE',
        ambulanceDisplayName: i.ambulance_id || 'AERO ALS',
        hospital: { 
          id: '', 
          name: i.destination_hospital || 'Hospital ER', 
          address: i.destination_address || '', 
          location: { latitude: i.destination_latitude || 0, longitude: i.destination_longitude || 0 }, 
          emergencyCapable: true 
        },
        patient: parsePatientData(i),
        currentSpeedKmH: isArrived ? 0 : (i.current_speed != null ? Math.round(i.current_speed) : undefined),
        route: {
          etaSeconds: isArrived ? 0 : (i.traffic_duration_seconds != null ? i.traffic_duration_seconds : i.route_duration_seconds),
          trafficAwareEtaSeconds: isArrived ? 0 : i.traffic_duration_seconds,
          isTrafficAware: i.traffic_status === 'LIVE' || i.route_provider === 'tomtom',
          trafficDelaySeconds: (i.traffic_duration_seconds && i.route_duration_seconds && !isArrived) 
            ? Math.max(0, i.traffic_duration_seconds - i.route_duration_seconds) 
            : 0,
          polyline: i.route_geometry || [],
          distanceMeters: isArrived ? 0 : (i.route_distance_meters || 0),
          routeProvider: i.route_provider || 'tomtom'
        },
        route_duration_seconds: isArrived ? 0 : i.route_duration_seconds,
        traffic_duration_seconds: isArrived ? 0 : i.traffic_duration_seconds,
        isTrafficAware: i.traffic_status === 'LIVE' || i.route_provider === 'tomtom',
        route_provider: i.route_provider || 'tomtom',
        vehicleNumber: i.ambulance_id || 'UNAVAILABLE',
        createdAt: i.created_at,
        arrivedAt: i.arrived_at,
        arrived_at: i.arrived_at
      } as Emergency;
    });
  },

  async updateHospitalCapacity(hospitalId: string, capacities: { availableIcuBeds?: number; traumaBaysAvailable?: number }) {
    const updateData: any = {};
    if (capacities.availableIcuBeds !== undefined) updateData.available_icu_beds = capacities.availableIcuBeds;
    if (capacities.traumaBaysAvailable !== undefined) updateData.trauma_bays_available = capacities.traumaBaysAvailable;
    updateData.updated_at = new Date().toISOString();
    
    const { error } = await supabase.from('hospitals').update(updateData).eq('id', hospitalId);
    return !error;
  },

  // ── Database-Backed Readiness Tasks ──
  async getIncidentReadiness(incidentId: string): Promise<HospitalReadinessState | null> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/hospital/incidents/${incidentId}/readiness`);
      if (res.ok) {
        const body = await res.json();
        if (body.success && body.readiness) return body.readiness;
      }
    } catch (e) {
      console.warn('[HospitalService] Readiness backend fetch failed:', e);
    }

    // Fallback directly to Supabase emergency_incidents record
    const { data: incident } = await supabase
      .from('emergency_incidents')
      .select('id, hospital_status, updated_at')
      .eq('id', incidentId)
      .maybeSingle();

    return {
      incidentId,
      hospitalStatus: (incident?.hospital_status as any) || 'PENDING',
      bayReadinessConfirmed: incident?.hospital_status === 'READY',
      confirmedAt: incident?.hospital_status === 'READY' ? incident.updated_at : null,
      confirmedBy: null,
      assignedSpecialist: null,
      tasks: [
        {
          id: `task_${incidentId}_trauma_bay`,
          taskType: 'trauma_bay',
          title: 'Trauma Resuscitation Bay 1',
          category: 'FACILITY',
          status: incident?.hospital_status === 'READY' ? 'READY' : 'PENDING',
          isMandatory: true,
          assignedTo: null,
          assignedRole: 'Trauma Bay Nurse',
          updatedAt: new Date().toISOString(),
          notes: 'Bay cleared and medical priming pending verification'
        },
        {
          id: `task_${incidentId}_icu_bed`,
          taskType: 'icu_bed',
          title: 'ICU Critical Bed & Mechanical Ventilator',
          category: 'CRITICAL_CARE',
          status: incident?.hospital_status === 'READY' ? 'READY' : 'PENDING',
          isMandatory: true,
          assignedTo: null,
          assignedRole: 'ICU Charge Staff',
          updatedAt: new Date().toISOString(),
          notes: 'Awaiting bed allocation and ventilator calibration'
        },
        {
          id: `task_${incidentId}_emergency_ot`,
          taskType: 'emergency_ot',
          title: 'Emergency Operating Theatre & Cath Lab',
          category: 'SURGICAL',
          status: 'PENDING',
          isMandatory: false,
          assignedTo: null,
          assignedRole: 'OT Coordinator',
          updatedAt: new Date().toISOString(),
          notes: 'Surgical suite on conditional standby'
        },
        {
          id: `task_${incidentId}_blood_bank`,
          taskType: 'blood_bank',
          title: 'Blood Bank Crossmatch & Emergency Units',
          category: 'BLOOD_BANK',
          status: 'PENDING',
          isMandatory: false,
          assignedTo: null,
          assignedRole: 'Transfusion Specialist',
          updatedAt: new Date().toISOString(),
          notes: 'O-Negative emergency reservation pending order'
        },
        {
          id: `task_${incidentId}_specialist_team`,
          taskType: 'specialist_team',
          title: 'On-Call Clinical Specialist Team',
          category: 'CLINICAL',
          status: incident?.hospital_status === 'READY' ? 'READY' : 'PENDING',
          isMandatory: true,
          assignedTo: null,
          assignedRole: 'Specialist Physician',
          updatedAt: new Date().toISOString(),
          notes: 'Specialist team notification pending incident confirmation'
        }
      ],
      lastUpdatedAt: new Date().toISOString()
    };
  },

  async updateReadinessTask(
    incidentId: string,
    taskId: string,
    status: ReadinessTaskStatus,
    notes?: string,
    assignedTo?: string,
    updatedBy?: string
  ): Promise<{ success: boolean; task?: any; error?: string }> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/hospital/incidents/${incidentId}/readiness/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, status, notes, assignedTo, updatedBy })
      });
      if (res.ok) {
        const body = await res.json();
        return { success: true, task: body.task };
      }
      const errBody = await res.json().catch(() => ({}));
      return { success: false, error: errBody.error || 'Failed to update readiness task' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error updating task' };
    }
  },

  async confirmBayReadiness(
    incidentId: string,
    confirmedBy?: string
  ): Promise<{ success: boolean; hospitalStatus?: string; confirmedAt?: string; error?: string; unreadyTasks?: string[] }> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/hospital/incidents/${incidentId}/confirm-readiness`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmedBy })
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) {
        // Redundant direct verification to Supabase database
        await supabase
          .from('emergency_incidents')
          .update({ hospital_status: 'READY' })
          .eq('id', incidentId);

        return { 
          success: true, 
          hospitalStatus: 'READY', 
          confirmedAt: body.confirmedAt || new Date().toISOString() 
        };
      }
      return { 
        success: false, 
        error: body.error || 'Validation failed. Mandatory readiness tasks must be READY.',
        unreadyTasks: body.unreadyTasks || []
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Could not connect to readiness confirmation endpoint' };
    }
  },

  async assignSpecialist(
    incidentId: string,
    specialist: { name: string; specialty?: string; contact?: string; assignedBy?: string }
  ): Promise<{ success: boolean; assignedSpecialist?: any; error?: string }> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/hospital/incidents/${incidentId}/assign-specialist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(specialist)
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) {
        return { success: true, assignedSpecialist: body.assignedSpecialist };
      }
      return { success: false, error: body.error || 'Failed to assign specialist' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error assigning specialist' };
    }
  },

  async getAvailableSpecialists(): Promise<Array<{ id: string; name: string; role: string; phone?: string | null; organization?: string }>> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/hospital/specialists`);
      if (res.ok) {
        const body = await res.json();
        if (body.specialists) return body.specialists;
      }
    } catch {
      // Fallback directly to Supabase profiles
    }

    const { data } = await supabase
      .from('profiles')
      .select('*')
      .in('role', ['hospital', 'hospital_operator', 'doctor', 'specialist']);

    return (data || []).map((p: any) => ({
      id: p.id,
      name: p.full_name || 'Staff Physician',
      role: p.role,
      phone: p.phone || null,
      organization: p.organization || 'Emergency Care Team'
    }));
  }
};
