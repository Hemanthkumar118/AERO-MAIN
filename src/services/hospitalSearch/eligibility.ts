import type { VerificationTier } from './types';

// Facilities that are strictly non-acute or elective, and must never receive acute emergency ambulances
const INELIGIBLE_CATEGORY_KEYWORDS = [
  // Alternative / Traditional Medicine
  'ayurveda', 'ayurvedic', 'ayuveda', 'ayur', 'homeopathy', 'homeopathic', 'naturopathy', 'nature cure',
  'ayush', 'unani', 'siddha', 'panchakarma', 'acupuncture', 'acupressure',
  // Dental & Oral
  'dental', 'dentist', 'orthodontic', 'tooth clinic', 'teeth', 'root canal',
  // Cosmetic, Dermatology & Wellness
  'cosmetic', 'cosmetology', 'hair transplant', 'laser clinic', 'plastic surgery',
  'skin clinic', 'skin care', 'beauty', 'spa', 'massage', 'slimming', 'weight loss',
  // Eye / Optical (outpatient spectacles / elective laser)
  'optical', 'optician', 'eye wear', 'spectacles', 'lenskart',
  // Diagnostic, Labs & Imaging
  'diagnostic', 'pathology', 'laboratory', 'path lab', 'scan center', 'scan centre',
  'mri center', 'x-ray', 'imaging center', 'ultrasound', 'blood bank', 'collection center',
  // Pharmacy & Retail
  'pharmacy', 'chemist', 'drug store', 'medical & general store', 'medical store', 'druggist', 'medicals',
  // Animal Care
  'veterinary', 'pet clinic', 'animal hospital', 'vet care', 'dog clinic', 'cat clinic',
  // Outpatient / Allied Health
  'physiotherapy clinic', 'physio', 'chiropractor', 'rehab clinic', 'rehabilitation center',
  'day care clinic', 'dispensary', 'consulting room'
];

export interface HospitalEligibilityAssessment {
  isExcludedFacility: boolean;
  verificationTier: VerificationTier;
  isEmergencyEligible: boolean;
  ineligibilityReason?: string;
  emergencyServices: string[];
}

/**
 * Assesses the emergency eligibility and verification tier of a healthcare facility.
 * 
 * Rules:
 * 1. Excludes non-acute facilities (Ayurveda, Dental, Pharmacy, Diagnostics, Wellness).
 * 2. Database registered hospitals with emergency_capable === true are "verified_emergency" (Eligible).
 * 3. Database registered hospitals with emergency_capable === false are "registered" (Ineligible).
 * 4. External POIs (TomTom, OSM, Google) are labeled "unverified" and cannot be selected as emergency destinations.
 */
export function assessHospitalEligibility(
  facilityName: string,
  provider: string,
  emergencyCapableFromDb?: boolean,
  types: string[] = []
): HospitalEligibilityAssessment {
  const cleanName = (facilityName || '').toLowerCase();
  const cleanTypes = types.map(t => t.toLowerCase());

  // 1. Check for non-acute facility keywords
  const isNonAcuteKeyword = INELIGIBLE_CATEGORY_KEYWORDS.some(kw => {
    return cleanName.includes(kw) || cleanTypes.some(t => t.includes(kw));
  });

  // If it's an alternative medicine, dental, wellness, pharmacy, or diagnostic facility:
  if (isNonAcuteKeyword) {
    let reason = 'Alternative / non-acute healthcare facility — not certified for acute trauma resuscitation';
    if (cleanName.includes('ayurveda') || cleanName.includes('ayurvedic') || cleanName.includes('ayuveda') || cleanName.includes('ayur')) {
      reason = 'Ayurvedic facility — not certified for acute emergency medicine / critical trauma care';
    } else if (cleanName.includes('homeo')) {
      reason = 'Homeopathic clinic — not equipped for acute emergency resuscitation';
    } else if (cleanName.includes('dental') || cleanName.includes('tooth')) {
      reason = 'Dental clinic — no acute emergency department';
    } else if (cleanName.includes('diagnostic') || cleanName.includes('pathology') || cleanName.includes('lab')) {
      reason = 'Diagnostic / laboratory center — no emergency inpatient beds';
    } else if (cleanName.includes('pharmacy') || cleanName.includes('chemist') || cleanName.includes('medical store')) {
      reason = 'Pharmacy / dispensary — non-hospital facility';
    }

    return {
      isExcludedFacility: provider !== 'db', // Completely exclude from external searches
      verificationTier: provider === 'db' ? 'registered' : 'unverified',
      isEmergencyEligible: false,
      ineligibilityReason: reason,
      emergencyServices: []
    };
  }

  // 2. Evaluated from AERO Registered Database
  if (provider === 'db') {
    if (emergencyCapableFromDb === true) {
      return {
        isExcludedFacility: false,
        verificationTier: 'verified_emergency',
        isEmergencyEligible: true,
        emergencyServices: ['24/7 Emergency Department', 'Trauma Resuscitation', 'Critical Care ICU']
      };
    } else {
      return {
        isExcludedFacility: false,
        verificationTier: 'registered',
        isEmergencyEligible: false,
        ineligibilityReason: 'Registered with AERO, but currently not certified for acute emergency admissions',
        emergencyServices: []
      };
    }
  }

  // 3. Evaluated from External Provider (TomTom Places / OSM / Google Places)
  // External place search results are unverified POIs without certified AERO ER integration
  return {
    isExcludedFacility: false,
    verificationTier: 'unverified',
    isEmergencyEligible: false,
    ineligibilityReason: 'Unverified external place result — not integrated into AERO active emergency dispatch network',
    emergencyServices: ['External Point of Interest (Advisory)']
  };
}
