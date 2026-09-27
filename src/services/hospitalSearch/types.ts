export interface RawHospitalResult {
  providerId: string;
  provider: 'google' | 'osm' | 'db';
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
}

export interface NormalizedHospital {
  id: string; // Internal AERO ID
  provider: 'google' | 'osm' | 'merged' | 'db';
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
  
  // Routing fields populated later by OSRM
  routeDistanceMeters?: number;
  routeDurationSeconds?: number;
  routePolyline?: [number, number][];
}
