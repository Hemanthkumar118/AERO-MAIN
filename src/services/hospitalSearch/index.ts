import type { NormalizedHospital } from './types';
import { searchTomTomHospitals } from './tomtomProvider';
import { searchOSMOverpass } from './osmProvider';
import { hospitalService } from '../hospitalService';
export { autocompleteGooglePlaces, getGooglePlaceDetails } from './googleProvider';

// Haversine straight-line distance formula
export function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

const searchCache = new Map<string, { data: NormalizedHospital[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

export function clearHospitalCache() {
  searchCache.clear();
}

// Healthcare non-hospital business exclusions
const EXCLUDED_HEALTHCARE_KEYWORDS = [
  'pharmacy', 'chemist', 'drug store', 'medical & general store', 'medical store', 'druggist', 'medicals',
  'diagnostic center', 'diagnostic centre', 'pathology', 'laboratory', 'path lab', 'scan center', 'scan centre', 'mri center', 'x-ray', 'imaging center',
  'dental', 'dentist', 'dental clinic', 'orthodontic', 'tooth clinic',
  'veterinary', 'pet clinic', 'animal hospital', 'vet care', 'dog clinic',
  'beauty', 'wellness', 'spa', 'massage', 'cosmetic', 'hair clinic', 'skin clinic', 'laser clinic',
  'optical', 'optician', 'eye wear', 'spectacles', 'lenskart',
  'physiotherapy clinic', 'chiropractor'
];

function isLegitimateHospital(name: string): boolean {
  if (!name) return false;
  const lowerName = name.toLowerCase();
  for (const kw of EXCLUDED_HEALTHCARE_KEYWORDS) {
    if (lowerName.includes(kw)) return false;
  }
  return true;
}

/**
 * Comprehensive Hospital Discovery:
 * - Uses TomTom Places/Search API as high-speed primary provider with multi-ring coverage
 * - Concurrently incorporates registered Supabase DB hospitals
 * - Falls back to OSM Overpass with resilient timeout if primary fails
 * - Validates straight-line geodesic distance against requested radius
 * - Deduplicates results across all sources using IDs and spatial proximity
 * - Sorts strictly by straight-line distance from ambulance GPS center
 */
export async function discoverHospitals(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  _autoExpand: boolean = false,
  signal?: AbortSignal
): Promise<{ radius: number; results: NormalizedHospital[] }> {
  const latBucket = centerLat.toFixed(3);
  const lngBucket = centerLng.toFixed(3);
  const cacheKey = `${latBucket}_${lngBucket}_${radiusMeters}`;

  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { radius: radiusMeters, results: cached.data };
  }

  const rawResults: NormalizedHospital[] = [];

  try {
    // 1. Primary: TomTom Search API (supports multi-ring radial discovery via backend proxy)
    const tomtomPromise = searchTomTomHospitals(centerLat, centerLng, radiusMeters, signal).catch(err => {
      if (err.name !== 'AbortError') console.warn('[TomTomProvider] Discovery warning:', err);
      return [];
    });

    // 2. Database: Supabase hospitals
    const dbPromise = hospitalService
      .getAllHospitals()
      .then(dbHospitals => {
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
          distanceMeters: Math.round(
            getDistanceMeters(centerLat, centerLng, h.location.latitude, h.location.longitude)
          )
        }));
      })
      .catch(() => []);

    const [tomtomResults, dbResults] = await Promise.all([tomtomPromise, dbPromise]);

    if (tomtomResults && tomtomResults.length > 0) {
      rawResults.push(...tomtomResults);
    }

    if (dbResults && dbResults.length > 0) {
      rawResults.push(...(dbResults as NormalizedHospital[]));
    }

    // 3. Fallback: If TomTom returned 0 results, query OSM Overpass with safety timeout
    if (rawResults.length === 0 && !signal?.aborted) {
      console.log('[HospitalSearch] Primary provider returned 0 results. Triggering OSM fallback...');
      try {
        const osmRaw = await searchOSMOverpass(centerLat, centerLng, radiusMeters, signal || new AbortController().signal);
        const osmHospitals = osmRaw.map(raw => ({
          id: raw.providerId,
          providerId: raw.providerId,
          provider: 'osm' as const,
          name: raw.name,
          lat: raw.lat,
          lng: raw.lng,
          address: raw.address,
          phone: raw.phone,
          types: raw.types,
          distanceMeters: Math.round(getDistanceMeters(centerLat, centerLng, raw.lat, raw.lng))
        }));
        rawResults.push(...osmHospitals);
      } catch (osmErr) {
        console.warn('[OSMProvider] Fallback query error:', osmErr);
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') return { radius: radiusMeters, results: [] };
    console.error('[HospitalSearch] Discovery failed:', err);
    throw err;
  }

  // Deduplication & Exact Straight-Line Radius Enforcement
  const normalizedMap = new Map<string, NormalizedHospital>();
  const providerIdSet = new Set<string>();
  const spatialGrid = new Map<string, NormalizedHospital>();

  for (const raw of rawResults) {
    if (!raw.lat || !raw.lng) continue;

    // Strict straight-line Haversine distance validation (exclude beyond selected radius)
    const dist = Math.round(getDistanceMeters(centerLat, centerLng, raw.lat, raw.lng));
    if (dist > radiusMeters) continue;

    if (raw.provider !== 'db' && !isLegitimateHospital(raw.name)) continue;

    // Fast exact-match dedup by provider + providerId
    const provKey = `${raw.provider}_${raw.providerId}`;
    if (providerIdSet.has(provKey)) continue;

    // Spatial proximity deduplication (25m cell bucket)
    const gridKey = `${Math.floor(raw.lat / 0.0005)}_${Math.floor(raw.lng / 0.0005)}`;
    const existing = spatialGrid.get(gridKey);
    if (
      existing &&
      (existing.name.toLowerCase() === raw.name.toLowerCase() ||
        getDistanceMeters(existing.lat, existing.lng, raw.lat, raw.lng) < 25)
    ) {
      continue;
    }

    providerIdSet.add(provKey);
    const internalId = raw.id || provKey;

    const hospital: NormalizedHospital = {
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
    };

    spatialGrid.set(gridKey, hospital);
    normalizedMap.set(internalId, hospital);
  }

  // Sort strictly ascending by straight-line distance from ambulance GPS center
  const finalList = Array.from(normalizedMap.values()).sort(
    (a, b) => a.distanceMeters - b.distanceMeters
  );

  // Cache valid results
  if (finalList.length > 0) {
    searchCache.set(cacheKey, { data: finalList, timestamp: Date.now() });
  }

  return { radius: radiusMeters, results: finalList };
}

/**
 * Autocomplete / Text Search for hospitals
 */
export async function searchHospitalsByText(
  query: string,
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  signal?: AbortSignal
): Promise<{ radius: number; results: NormalizedHospital[] }> {
  if (!query || query.trim().length < 2) {
    return { radius: radiusMeters, results: [] };
  }

  const cleanQuery = query.trim().toLowerCase();
  const cacheKey = `text_${cleanQuery}_${centerLat.toFixed(3)}_${centerLng.toFixed(3)}_${radiusMeters}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 1000 * 60) {
    return { radius: radiusMeters, results: cached.data };
  }

  try {
    const rawResults = await searchTomTomHospitals(centerLat, centerLng, radiusMeters, signal, cleanQuery);

    const normalizedMap = new Map<string, NormalizedHospital>();
    for (const raw of rawResults) {
      if (!raw.lat || !raw.lng) continue;
      const dist = Math.round(getDistanceMeters(centerLat, centerLng, raw.lat, raw.lng));

      if (dist > radiusMeters * 1.005) continue;
      if (!isLegitimateHospital(raw.name)) continue;

      const internalId = raw.id || `${raw.provider}_${raw.providerId}`;
      normalizedMap.set(internalId, {
        ...raw,
        id: internalId,
        distanceMeters: dist
      });
    }

    const finalList = Array.from(normalizedMap.values()).sort(
      (a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0)
    );

    searchCache.set(cacheKey, { data: finalList, timestamp: Date.now() });
    return { radius: radiusMeters, results: finalList };
  } catch (err: any) {
    if (err.name === 'AbortError') return { radius: radiusMeters, results: [] };
    console.error('[HospitalSearch] Text search failed:', err);
    throw err;
  }
}
