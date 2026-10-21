export type VerificationTier = 'verified_emergency' | 'registered' | 'unverified';

export interface RawHospitalResult {
  providerId: string;
  provider: 'google' | 'osm' | 'db' | 'mappls' | 'tomtom';
  name: string;
  lat: number;
  lng: number;
  distanceMeters?: number;
  address?: string;
  phone?: string;
  rating?: number;
  reviewCount?: number;
  openNow?: boolean;
  businessStatus?: string;
  types: string[];
  googleMapsUri?: string;
}

export interface NormalizedHospital {
  id: string; // Internal AERO ID
  provider: 'google' | 'osm' | 'merged' | 'db' | 'mappls' | 'tomtom';
  providerId: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  phone?: string;
  rating?: number;
  reviewCount?: number;
  openNow?: boolean;
  businessStatus?: string;
  types: string[];
  distanceMeters: number; // Straight-line distance from search center
  googleMapsUri?: string;
  
  // Emergency Eligibility & Verification
  verificationTier: VerificationTier;
  isEmergencyEligible: boolean;
  ineligibilityReason?: string;
  emergencyCapable?: boolean;
  totalBeds?: number | null;
  availableIcuBeds?: number | null;
  traumaBaysAvailable?: number | null;

  // Routing fields populated later by routing service
  routeDistanceMeters?: number;
  routeDurationSeconds?: number;
  routePolyline?: [number, number][];
}
