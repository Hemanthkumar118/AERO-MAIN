import { supabase } from '../lib/supabase';

import { getBackendUrl } from './apiConfig';

const API_BASE_URL = getBackendUrl();

export interface ClinicalObservationPayload {
  ambulanceId?: string;
  hospitalId?: string;
  hospitalName?: string;
  emergencyCategory: string;
  triageSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  heartRate?: number | null;
  systolicBp?: number | null;
  diastolicBp?: number | null;
  spo2?: number | null;
  respiratoryRate?: number | null;
  gcs?: number | null;
  temperature?: number | null;
  chiefComplaint?: string | null;
  clinicalNotes?: string | null;
  isManual?: boolean;
  sourceDevice?: string;
}

export interface ClinicalObservation {
  id: string;
  incident_id: string;
  recorded_by?: string;
  recorded_by_name?: string;
  recorded_by_role: string;
  ambulance_id?: string;
  hospital_id?: string;
  hospital_name?: string;
  
  heart_rate?: number | null;
  systolic_bp?: number | null;
  diastolic_bp?: number | null;
  spo2?: number | null;
  respiratory_rate?: number | null;
  gcs?: number | null;
  temperature?: number | null;
  
  emergency_category: string;
  triage_severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  chief_complaint?: string | null;
  clinical_notes?: string | null;
  is_manual: boolean;
  source_device: string;
  
  recorded_at: string;
  created_at: string;
  updated_at: string;
}

async function getAuthToken(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) return session.access_token;
  } catch (e) {}

  if (typeof window !== 'undefined') {
    // Check unified AERO session key
    const unified = localStorage.getItem('aero-auth-session');
    if (unified) {
      try {
        const parsed = JSON.parse(unified);
        if (parsed.access_token) return parsed.access_token;
      } catch (e) {}
    }

    // Fallback to legacy role-based local storage tokens for dev sessions
    const roles = ['ambulance', 'police', 'hospital', 'admin', 'default'];
    for (const r of roles) {
      const stored = localStorage.getItem(`aero-session-${r}`);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.access_token) return parsed.access_token;
        } catch (e) {}
      }
    }
  }

  // Non-production fallback only
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    return 'mock-token-ambulance';
  }
  return null;
}

export const clinicalService = {
  /**
   * Submit pre-hospital clinical assessment & vitals for an incident
   */
  async recordObservation(incidentId: string, payload: ClinicalObservationPayload): Promise<ClinicalObservation> {
    const token = await getAuthToken();
    const res = await fetch(`${API_BASE_URL}/api/incidents/${incidentId}/clinical-observations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Network error submitting clinical vitals' }));
      throw new Error(err.error || `HTTP ${res.status}: Failed to record clinical observations`);
    }

    const json = await res.json();
    return json.observation;
  },

  /**
   * Retrieve clinical observations for an incident
   */
  async getObservations(incidentId: string): Promise<ClinicalObservation[]> {
    const token = await getAuthToken();
    const res = await fetch(`${API_BASE_URL}/api/incidents/${incidentId}/clinical-observations`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to fetch clinical observations' }));
      throw new Error(err.error || `HTTP ${res.status}: Failed to fetch clinical observations`);
    }

    const json = await res.json();
    return json.observations || [];
  },

  /**
   * Hospital incident status update (Acknowledge, Ready, Arrive, Complete Handover)
   */
  async updateHospitalStatus(
    incidentId: string, 
    payload: { status?: string; hospitalStatus?: string; notes?: string }
  ): Promise<any> {
    const token = await getAuthToken();
    const res = await fetch(`${API_BASE_URL}/api/hospital/incidents/${incidentId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update hospital status' }));
      throw new Error(err.error || `HTTP ${res.status}: Failed to update hospital status`);
    }

    return await res.json();
  }
};
