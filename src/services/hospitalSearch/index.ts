import type { NormalizedHospital } from './types';
import { searchMappls } from './mapplsProvider';
import { searchOSMOverpass } from './osmProvider';
import { hospitalService } from '../hospitalService';
import { searchGooglePlacesSingle, searchGooglePlacesByText } from './googleProvider';
export { autocompleteGooglePlaces, getGooglePlaceDetails } from './googleProvider';

// Haversine distance formula
export function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (window.google?.maps?.geometry?.spherical?.computeDistanceBetween) {
    const p1 = new window.google.maps.LatLng(lat1, lon1);
    const p2 = new window.google.maps.LatLng(lat2, lon2);
    return window.google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
  }
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

const searchCache = new Map<string, { data: NormalizedHospital[], timestamp: number }>();


export function clearHospitalCache() {
  searchCache.clear();
}


const INVALID_KEYWORDS = [
  'ayurveda', 'ayurvedic', 'physiotherapy', 'pharmacy', 'pharmacies',
  'medical & general', 'medical and general', 'medical store',
  'generic', 'clinic', 'diagnostic', 'veterinary', 'blood bank', 'dentist',
  'dental', 'eye center', 'eye care', 'optical', 'primary health',
  'phc ', 'homeopathy', 'homeopathic'
];

function isActualHospital(name: string): boolean {
  const lowerName = name.toLowerCase();
  for (const kw of INVALID_KEYWORDS) {
    if (lowerName.includes(kw)) return false;
  }
  return true;
}

export async function discoverHospitals(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  _autoExpand: boolean = false
): Promise<{ radius: number, results: NormalizedHospital[] }> {
  
    
  console.log(`\n--- AERO HOSPITAL DEBUG ---`);
  console.log(`GPS: ${centerLat.toFixed(6)}, ${centerLng.toFixed(6)}`);
  console.log(`Radius: ${radiusMeters / 1000} km`);
  
  const latBucket = centerLat.toFixed(3);
  const lngBucket = centerLng.toFixed(3);
  const cacheKey = `${latBucket}_${lngBucket}_${radiusMeters}`;
  
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 1000 * 60 * 5) { // 5 min TTL
    console.log(`[HospitalSearch] Serving from cache: ${cacheKey}`);
    return { radius: radiusMeters, results: cached.data };
  }

  const rawResults: NormalizedHospital[] = [];

  try {
    // 1. Mappls Nearby Search
    const mapplsPromise = searchMappls(centerLat, centerLng, radiusMeters).catch(err => {
      console.error("[MapplsProvider] Discovery failed:", err);
      return [];
    });

    // Start DB search concurrently
    const dbPromise = hospitalService.getAllHospitals().then(dbHospitals => {
      return dbHospitals.map(h => ({
        id: `db_${h.id}`,
        providerId: h.id,
        provider: 'db' as const,
        name: h.name,
        lat: h.location.latitude,
        lng: h.location.longitude,
        address: h.address,
        phone: h.phone,
        types: ['hospital'],
        distanceMeters: getDistanceMeters(centerLat, centerLng, h.location.latitude, h.location.longitude)
      }));
    }).catch(err => {
      console.error("[DBProvider] Discovery failed:", err);
      return [];
    });
    // Start Google Places search concurrently
    const googlePromise = searchGooglePlacesSingle(centerLat, centerLng, radiusMeters, undefined, new AbortController().signal).catch(err => {
      console.error("[GoogleProvider] Discovery failed:", err);
      return [];
    });
    
    // Start OSM search concurrently
    const osmPromise = searchOSMOverpass(centerLat, centerLng, radiusMeters, new AbortController().signal).catch(err => {
      console.error("[OSMProvider] Discovery failed:", err);
      return [];
    });
    
    const [googleRawResults, mapplsResults, dbResults, osmRawResults] = await Promise.all([googlePromise, mapplsPromise, dbPromise, osmPromise]);

    const googleResults = googleRawResults.map(raw => ({
      id: raw.providerId,
      providerId: raw.providerId,
      provider: 'google' as const,
      name: raw.name,
      lat: raw.lat,
      lng: raw.lng,
      address: raw.address,
      phone: raw.phone,
      types: raw.types,
      distanceMeters: getDistanceMeters(centerLat, centerLng, raw.lat, raw.lng)
    }));

    const osmResults = osmRawResults.map(raw => ({
      id: raw.providerId,
      providerId: raw.providerId,
      provider: 'osm' as const,
      name: raw.name,
      lat: raw.lat,
      lng: raw.lng,
      address: raw.address,
      phone: raw.phone,
      types: raw.types,
      distanceMeters: getDistanceMeters(centerLat, centerLng, raw.lat, raw.lng)
    }));
    
    if (googleResults.length > 0) {
      rawResults.push(...googleResults);
    }
    
    if (mapplsResults) {
      rawResults.push(...mapplsResults);
    }

    if (dbResults) {
      rawResults.push(...dbResults as NormalizedHospital[]);
    }

    if (osmResults) {
      rawResults.push(...osmResults as NormalizedHospital[]);
    }
  } catch (err: any) {
    console.error("[HospitalSearch] Discovery failed:", err);
    throw err; // bubble up the error to display
  }

  const mergedCount = rawResults.length;

  // 3. Deduplication and Normalization
  const normalizedMap = new Map<string, NormalizedHospital>();
  
  for (const raw of rawResults) {
    const dist = raw.distanceMeters ?? getDistanceMeters(centerLat, centerLng, raw.lat, raw.lng);
    
    // Filter out items strictly outside the requested radius
    if (dist > radiusMeters) continue;

    if (!isActualHospital(raw.name)) continue;

    // Check for existing by name & proximity (within 100 meters)
    let isDuplicate = false;

    for (const existing of normalizedMap.values()) {
      if (existing.providerId === raw.providerId && existing.provider === raw.provider) {
         isDuplicate = true;
         break;
      }
      
      const distanceBetween = getDistanceMeters(existing.lat, existing.lng, raw.lat, raw.lng);
      
      // Similarity check (same name string matches, or very close proximity)
      if (distanceBetween < 100) {
         if (existing.name.toLowerCase() === raw.name.toLowerCase() || distanceBetween < 20) {
            isDuplicate = true;
            break;
         }
      }
    }

    if (isDuplicate) {
      continue;
    }

    const internalId = `${raw.provider}_${raw.providerId}`;
    
    normalizedMap.set(internalId, {
      id: internalId,
      provider: raw.provider,
      providerId: raw.providerId,
      name: raw.name,
      lat: raw.lat,
      lng: raw.lng,
      address: raw.address,
      phone: raw.phone,
      rating: raw.rating,
      reviewCount: raw.reviewCount,
      openNow: raw.openNow,
      businessStatus: raw.businessStatus,
      types: raw.types,
      distanceMeters: dist
    });
  }

  const finalList = Array.from(normalizedMap.values()).sort((a, b) => a.distanceMeters - b.distanceMeters);

  console.log(`Merged: ${mergedCount}`);
  console.log(`Deduplicated & within radius: ${finalList.length}`);
  console.log(`List: ${finalList.length}`);
  console.log(`Markers: ${finalList.length}`);
  console.log(`---------------------------\n`);

  searchCache.set(cacheKey, { data: finalList, timestamp: Date.now() });

  return { radius: radiusMeters, results: finalList };
}

export async function searchHospitalsByText(
  query: string,
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  signal?: AbortSignal
): Promise<{ radius: number, results: NormalizedHospital[] }> {
  const safeSignal = signal || new AbortController().signal;
  
  if (!query || query.trim().length < 2) {
    return { radius: radiusMeters, results: [] };
  }

  const cacheKey = `text_${query.trim().toLowerCase()}_${centerLat.toFixed(3)}_${centerLng.toFixed(3)}_${radiusMeters}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 1000 * 30) { // 30 sec TTL for text search
    console.log(`[HospitalSearch] Serving TEXT from cache: ${cacheKey}`);
    return { radius: radiusMeters, results: cached.data };
  }

  try {
    const rawResults = await searchGooglePlacesByText(query, centerLat, centerLng, radiusMeters, safeSignal);
    
    // Process and filter
    const normalizedMap = new Map<string, NormalizedHospital>();
    for (const raw of rawResults) {
      const dist = raw.distanceMeters ?? getDistanceMeters(centerLat, centerLng, raw.lat, raw.lng);
      
      // Strict distance filtering for text search too
      if (dist > radiusMeters) continue;

    if (!isActualHospital(raw.name)) continue;

      const internalId = `${raw.provider}_${raw.providerId}`;
      normalizedMap.set(internalId, {
        id: internalId,
        provider: raw.provider,
        providerId: raw.providerId,
        name: raw.name,
        lat: raw.lat,
        lng: raw.lng,
        address: raw.address,
        phone: raw.phone,
        rating: raw.rating,
        reviewCount: raw.reviewCount,
        openNow: raw.openNow,
        businessStatus: raw.businessStatus,
        types: raw.types,
        distanceMeters: dist
      });
    }

    const finalList = Array.from(normalizedMap.values()).sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
    searchCache.set(cacheKey, { data: finalList, timestamp: Date.now() });

    return { radius: radiusMeters, results: finalList };
  } catch (err: any) {
    console.error("[HospitalSearch] Text search failed:", err);
    throw err;
  }
}
