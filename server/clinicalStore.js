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

// Documented, configurable physiological ranges and units
export const CLINICAL_VALIDATION_RULES = {
  heartRate: { min: 20, max: 300, unit: 'bpm', label: 'Heart Rate' },
  systolicBp: { min: 40, max: 300, unit: 'mmHg', label: 'Systolic BP' },
  diastolicBp: { min: 20, max: 200, unit: 'mmHg', label: 'Diastolic BP' },
  spo2: { min: 50, max: 100, unit: '%', label: 'SpO2 Oxygen Saturation' },
  respiratoryRate: { min: 4, max: 80, unit: 'breaths/min', label: 'Respiratory Rate' },
  gcs: { min: 3, max: 15, unit: 'score', label: 'Glasgow Coma Scale (GCS)' },
  temperature: { min: 30.0, max: 45.0, unit: '°C', label: 'Body Temperature' }
};

export function validateObservationPayload(payload) {
  const errors = [];

  // 1. Emergency category
  const category = (payload.emergencyCategory || payload.emergency_category || '').toUpperCase();
  if (!category || !VALID_CATEGORIES.includes(category)) {
    errors.push(`Invalid emergencyCategory. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  // 2. Triage severity
  const severity = (payload.triageSeverity || payload.triage_severity || 'CRITICAL').toUpperCase();
  if (!VALID_SEVERITIES.includes(severity)) {
    errors.push(`Invalid triageSeverity. Must be one of: ${VALID_SEVERITIES.join(', ')}`);
  }

  // 3. Heart rate (bpm) — distinguishing missing from zero
  if (payload.heartRate != null && payload.heartRate !== '') {
    const hr = Number(payload.heartRate);
    if (isNaN(hr) || !Number.isInteger(hr) || hr <= 0) {
      errors.push('Heart rate must be a positive integer in bpm (0 or non-numeric values are rejected).');
    } else if (hr < CLINICAL_VALIDATION_RULES.heartRate.min || hr > CLINICAL_VALIDATION_RULES.heartRate.max) {
      errors.push(`Heart rate (${hr} bpm) is outside physiological range (${CLINICAL_VALIDATION_RULES.heartRate.min}-${CLINICAL_VALIDATION_RULES.heartRate.max} bpm).`);
    }
  }

  // 4. Blood pressure coupling: Require both values together when blood pressure is entered
  const hasSystolic = payload.systolicBp != null && payload.systolicBp !== '';
  const hasDiastolic = payload.diastolicBp != null && payload.diastolicBp !== '';

  if (hasSystolic && !hasDiastolic) {
    errors.push('Incomplete blood pressure reading: Diastolic BP is required when Systolic BP is entered.');
  } else if (!hasSystolic && hasDiastolic) {
    errors.push('Incomplete blood pressure reading: Systolic BP is required when Diastolic BP is entered.');
  } else if (hasSystolic && hasDiastolic) {
    const sys = Number(payload.systolicBp);
    const dia = Number(payload.diastolicBp);

    if (isNaN(sys) || !Number.isInteger(sys) || sys <= 0) {
      errors.push('Systolic BP must be a positive integer in mmHg (0 or non-numeric values are rejected).');
    } else if (sys < CLINICAL_VALIDATION_RULES.systolicBp.min || sys > CLINICAL_VALIDATION_RULES.systolicBp.max) {
      errors.push(`Systolic BP (${sys} mmHg) is outside physiological range (${CLINICAL_VALIDATION_RULES.systolicBp.min}-${CLINICAL_VALIDATION_RULES.systolicBp.max} mmHg).`);
    }

    if (isNaN(dia) || !Number.isInteger(dia) || dia <= 0) {
      errors.push('Diastolic BP must be a positive integer in mmHg (0 or non-numeric values are rejected).');
    } else if (dia < CLINICAL_VALIDATION_RULES.diastolicBp.min || dia > CLINICAL_VALIDATION_RULES.diastolicBp.max) {
      errors.push(`Diastolic BP (${dia} mmHg) is outside physiological range (${CLINICAL_VALIDATION_RULES.diastolicBp.min}-${CLINICAL_VALIDATION_RULES.diastolicBp.max} mmHg).`);
    }

    if (!isNaN(sys) && !isNaN(dia) && sys > 0 && dia > 0 && sys <= dia) {
      errors.push(`Physiological inconsistency: Systolic BP (${sys} mmHg) must be strictly greater than Diastolic BP (${dia} mmHg).`);
    }
  }

  // 5. SpO2 (%) — oxygen saturation
  if (payload.spo2 != null && payload.spo2 !== '') {
    const o2 = Number(payload.spo2);
    if (isNaN(o2) || !Number.isInteger(o2) || o2 <= 0) {
      errors.push('SpO2 oxygen saturation must be a positive integer percentage (0 or non-numeric values are rejected).');
    } else if (o2 < CLINICAL_VALIDATION_RULES.spo2.min || o2 > CLINICAL_VALIDATION_RULES.spo2.max) {
      errors.push(`SpO2 (${o2}%) is outside valid range (${CLINICAL_VALIDATION_RULES.spo2.min}-${CLINICAL_VALIDATION_RULES.spo2.max}%).`);
    }
  }

  // 6. Respiratory rate (breaths/min)
  if (payload.respiratoryRate != null && payload.respiratoryRate !== '') {
    const rr = Number(payload.respiratoryRate);
    if (isNaN(rr) || !Number.isInteger(rr) || rr <= 0) {
      errors.push('Respiratory rate must be a positive integer in breaths/min (0 or non-numeric values are rejected).');
    } else if (rr < CLINICAL_VALIDATION_RULES.respiratoryRate.min || rr > CLINICAL_VALIDATION_RULES.respiratoryRate.max) {
      errors.push(`Respiratory rate (${rr} breaths/min) is outside valid range (${CLINICAL_VALIDATION_RULES.respiratoryRate.min}-${CLINICAL_VALIDATION_RULES.respiratoryRate.max} breaths/min).`);
    }
  }

  // 7. Glasgow Coma Scale (3-15)
  if (payload.gcs != null && payload.gcs !== '') {
    const gcs = Number(payload.gcs);
    if (isNaN(gcs) || !Number.isInteger(gcs) || gcs <= 0) {
      errors.push('Glasgow Coma Scale (GCS) must be an integer between 3 and 15 (0 or non-numeric values are rejected).');
    } else if (gcs < CLINICAL_VALIDATION_RULES.gcs.min || gcs > CLINICAL_VALIDATION_RULES.gcs.max) {
      errors.push(`Glasgow Coma Scale (${gcs}) is outside valid clinical range (${CLINICAL_VALIDATION_RULES.gcs.min}-${CLINICAL_VALIDATION_RULES.gcs.max}).`);
    }
  }

  // 8. Body Temperature (°C)
  if (payload.temperature != null && payload.temperature !== '') {
    const temp = Number(payload.temperature);
    if (isNaN(temp) || temp <= 0) {
      errors.push('Body temperature must be a positive decimal number in °C (0 or non-numeric values are rejected).');
    } else if (temp < CLINICAL_VALIDATION_RULES.temperature.min || temp > CLINICAL_VALIDATION_RULES.temperature.max) {
      errors.push(`Body temperature (${temp}°C) is outside physiological range (${CLINICAL_VALIDATION_RULES.temperature.min}-${CLINICAL_VALIDATION_RULES.temperature.max}°C).`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: {
      emergencyCategory: category,
      triageSeverity: severity,
      heartRate: payload.heartRate != null && payload.heartRate !== '' ? Number(payload.heartRate) : null,
      systolicBp: hasSystolic ? Number(payload.systolicBp) : null,
      diastolicBp: hasDiastolic ? Number(payload.diastolicBp) : null,
      spo2: payload.spo2 != null && payload.spo2 !== '' ? Number(payload.spo2) : null,
      respiratoryRate: payload.respiratoryRate != null && payload.respiratoryRate !== '' ? Number(payload.respiratoryRate) : null,
      gcs: payload.gcs != null && payload.gcs !== '' ? Number(payload.gcs) : null,
      temperature: payload.temperature != null && payload.temperature !== '' ? Number(payload.temperature) : null,
      chiefComplaint: payload.chiefComplaint ? String(payload.chiefComplaint).trim() : null,
      clinicalNotes: payload.clinicalNotes ? String(payload.clinicalNotes).trim() : null,
      isManual: true,
      sourceDevice: payload.sourceDevice || 'PARAMEDIC_MANUAL_ENTRY'
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
  },

  /**
   * Clear all observations for an incident (e.g. when incident is nuked)
   */
  clearIncidentObservations(incidentId) {
    const localStore = loadLocalStore();
    localStore.observations = localStore.observations.filter(o => o.incident_id !== incidentId);
    saveLocalStore(localStore);
  }
};
