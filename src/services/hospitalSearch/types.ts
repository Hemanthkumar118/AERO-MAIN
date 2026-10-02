export interface RawHospitalResult {
  providerId: string;
  provider: 'google' | 'osm' | 'db' | 'mappls';
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
  provider: 'google' | 'osm' | 'merged' | 'db' | 'mappls';
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
  
  // Routing fields populated later by routing service
  routeDistanceMeters?: number;
  routeDurationSeconds?: number;
  routePolyline?: [number, number][];
}
