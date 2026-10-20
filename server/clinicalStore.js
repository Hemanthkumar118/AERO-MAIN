import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'clinical_store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadLocalStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const data = fs.readFileSync(STORE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('[Clinical Store] Failed to read store file, reinitializing:', err);
  }
  return { observations: [] };
}

function saveLocalStore(store) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Clinical Store] Failed to write store file:', err);
  }
}

export const VALID_CATEGORIES = [
  'TRAUMA',
  'POLYTRAUMA',
  'CARDIAC',
  'RESPIRATORY',
  'STROKE',
  'SEPSIS',
  'PEDIATRIC',
  'BURNS',
  'GENERAL',
  'GENERAL_MEDICAL',
  'OTHER'
];

export const VALID_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export function validateObservationPayload(payload) {
  const errors = [];

  // Emergency category
  const category = (payload.emergencyCategory || payload.emergency_category || '').toUpperCase();
  if (!category || !VALID_CATEGORIES.includes(category)) {
    errors.push(`Invalid emergencyCategory. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  // Triage severity
  const severity = (payload.triageSeverity || payload.triage_severity || 'CRITICAL').toUpperCase();
  if (!VALID_SEVERITIES.includes(severity)) {
    errors.push(`Invalid triageSeverity. Must be one of: ${VALID_SEVERITIES.join(', ')}`);
  }

  // Heart rate (bpm)
  if (payload.heartRate != null && payload.heartRate !== '') {
    const hr = Number(payload.heartRate);
    if (!Number.isInteger(hr) || hr < 20 || hr > 300) {
      errors.push('Heart rate must be an integer between 20 and 300 bpm.');
    }
  }

  // Systolic BP (mmHg)
  if (payload.systolicBp != null && payload.systolicBp !== '') {
    const sys = Number(payload.systolicBp);
    if (!Number.isInteger(sys) || sys < 40 || sys > 300) {
      errors.push('Systolic BP must be an integer between 40 and 300 mmHg.');
    }
  }

  // Diastolic BP (mmHg)
  if (payload.diastolicBp != null && payload.diastolicBp !== '') {
    const dia = Number(payload.diastolicBp);
    if (!Number.isInteger(dia) || dia < 20 || dia > 200) {
      errors.push('Diastolic BP must be an integer between 20 and 200 mmHg.');
    }
  }

  // SpO2 (%)
  if (payload.spo2 != null && payload.spo2 !== '') {
    const o2 = Number(payload.spo2);
    if (!Number.isInteger(o2) || o2 < 50 || o2 > 100) {
      errors.push('SpO2 oxygen saturation must be an integer between 50% and 100%.');
    }
  }

  // Respiratory rate (breaths/min)
  if (payload.respiratoryRate != null && payload.respiratoryRate !== '') {
    const rr = Number(payload.respiratoryRate);
    if (!Number.isInteger(rr) || rr < 4 || rr > 80) {
      errors.push('Respiratory rate must be an integer between 4 and 80 breaths/min.');
    }
  }

  // Glasgow Coma Scale (3-15)
  if (payload.gcs != null && payload.gcs !== '') {
    const gcs = Number(payload.gcs);
    if (!Number.isInteger(gcs) || gcs < 3 || gcs > 15) {
      errors.push('Glasgow Coma Scale (GCS) must be an integer between 3 and 15.');
    }
  }

  // Temperature (°C)
  if (payload.temperature != null && payload.temperature !== '') {
    const temp = Number(payload.temperature);
    if (isNaN(temp) || temp < 30.0 || temp > 45.0) {
      errors.push('Body temperature must be between 30.0°C and 45.0°C.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: {
      emergencyCategory: category,
      triageSeverity: severity,
      heartRate: payload.heartRate != null && payload.heartRate !== '' ? Number(payload.heartRate) : null,
      systolicBp: payload.systolicBp != null && payload.systolicBp !== '' ? Number(payload.systolicBp) : null,
      diastolicBp: payload.diastolicBp != null && payload.diastolicBp !== '' ? Number(payload.diastolicBp) : null,
      spo2: payload.spo2 != null && payload.spo2 !== '' ? Number(payload.spo2) : null,
      respiratoryRate: payload.respiratoryRate != null && payload.respiratoryRate !== '' ? Number(payload.respiratoryRate) : null,
      gcs: payload.gcs != null && payload.gcs !== '' ? Number(payload.gcs) : null,
      temperature: payload.temperature != null && payload.temperature !== '' ? Number(payload.temperature) : null,
      chiefComplaint: payload.chiefComplaint ? String(payload.chiefComplaint).trim() : null,
      clinicalNotes: payload.clinicalNotes ? String(payload.clinicalNotes).trim() : null,
      isManual: true,
      sourceDevice: payload.sourceDevice || 'MANUAL_PARAMEDIC_ENTRY'
    }
  };
}

export const clinicalStore = {
  /**
   * Record a new clinical observation for an incident with authenticated user validation
   */
  async recordObservation(incidentId, payload, user, supabase) {
    const { isValid, errors, sanitized } = validateObservationPayload(payload);
    if (!isValid) {
      const err = new Error(errors.join(' '));
      err.statusCode = 400;
      throw err;
    }

    const now = new Date().toISOString();
    const observationId = crypto.randomUUID();

    const record = {
      id: observationId,
      incident_id: incidentId,
      recorded_by: user.id,
      recorded_by_name: user.user_metadata?.full_name || user.email || 'Ambulance Paramedic',
      recorded_by_role: user.role || user.user_metadata?.role || 'ambulance',
      ambulance_id: payload.ambulanceId || user.user_metadata?.vehicle_number || user.id,
      hospital_id: payload.hospitalId || null,
      hospital_name: payload.hospitalName || null,
      
      heart_rate: sanitized.heartRate,
      systolic_bp: sanitized.systolicBp,
      diastolic_bp: sanitized.diastolicBp,
      spo2: sanitized.spo2,
      respiratory_rate: sanitized.respiratoryRate,
      gcs: sanitized.gcs,
      temperature: sanitized.temperature,
      
      emergency_category: sanitized.emergencyCategory,
      triage_severity: sanitized.triageSeverity,
      chief_complaint: sanitized.chiefComplaint,
      clinical_notes: sanitized.clinicalNotes,
      is_manual: sanitized.isManual,
      source_device: sanitized.sourceDevice,
      
      recorded_at: now,
      created_at: now,
      updated_at: now
    };

    // 1. Try remote Supabase insert
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('clinical_observations')
          .insert(record)
          .select()
          .single();

        if (!error && data) {
          // Also save in local fallback store for redundancy
          const localStore = loadLocalStore();
          localStore.observations.unshift(data);
          saveLocalStore(localStore);
          return data;
        }
      } catch (err) {
        console.warn('[Clinical Store] Remote insert failed, falling back to local resilient store:', err.message);
      }
    }

    // 2. Local resilient store fallback
    const localStore = loadLocalStore();
    localStore.observations.unshift(record);
    saveLocalStore(localStore);
    return record;
  },

  /**
   * Get all clinical observations for an incident (ordered newest first)
   */
  async getObservations(incidentId, supabase) {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('clinical_observations')
          .select('*')
          .eq('incident_id', incidentId)
          .order('recorded_at', { ascending: false });

        if (!error && data && data.length > 0) {
          return data;
        }
      } catch (err) {
        console.warn('[Clinical Store] Remote query failed, checking local store:', err.message);
      }
    }

    const localStore = loadLocalStore();
    return localStore.observations
      .filter(o => o.incident_id === incidentId)
      .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
  },

  /**
   * Get latest observation for an incident
   */
  async getLatestObservation(incidentId, supabase) {
    const list = await this.getObservations(incidentId, supabase);
    return list.length > 0 ? list[0] : null;
  }
};
