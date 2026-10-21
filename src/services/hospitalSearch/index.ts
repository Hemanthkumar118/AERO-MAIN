import type { NormalizedHospital } from './types';
import { assessHospitalEligibility } from './eligibility';
import { searchTomTomHospitals } from './tomtomProvider';
import { searchOSMOverpass } from './osmProvider';
import { hospitalService } from '../hospitalService';
export { autocompleteGooglePlaces, getGooglePlaceDetails } from './googleProvider';
export { assessHospitalEligibility } from './eligibility';

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

/**
 * Comprehensive Hospital Discovery:
 * - Uses TomTom Places/Search API as high-speed primary provider with multi-ring coverage
 * - Concurrently incorporates registered Supabase DB hospitals
 * - Evaluates multi-tiered emergency eligibility (Verified Emergency, Registered, Unverified External)
 * - Excludes non-acute facilities (Ayurveda, Dental, Pharmacy, Diagnostics, Wellness)
 * - Validates straight-line geodesic distance strictly against requested radius
 * - Deduplicates results across all sources using IDs and spatial proximity
 * - Sorts with verified emergency facilities first, then strictly ascending by distance
 */
export async function discoverHospitals(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  _autoExpand: boolean = false,
  signal?: AbortSignal
): Promise<{ radius: number; results: NormalizedHospital[] }> {
  // Guard against invalid coordinates
  if (!centerLat || !centerLng || isNaN(centerLat) || isNaN(centerLng)) {
    return { radius: radiusMeters, results: [] };
  }

  const latBucket = centerLat.toFixed(3);
  const lngBucket = centerLng.toFixed(3);
  const cacheKey = `${latBucket}_${lngBucket}_${radiusMeters}`;

  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { radius: radiusMeters, results: cached.data };
  }

  const rawResults: any[] = [];

  try {
    // 1. Primary: TomTom Search API (supports multi-ring radial discovery via backend proxy)
    const tomtomPromise = searchTomTomHospitals(centerLat, centerLng, radiusMeters, signal).catch(err => {
      if (err.name !== 'AbortError') console.warn('[TomTomProvider] Discovery warning:', err);
      return [];
    });

    // 2. Database: Supabase registered hospitals
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
          emergencyCapable: h.emergencyCapable,
          totalBeds: h.totalBeds,
          availableIcuBeds: h.availableIcuBeds,
          traumaBaysAvailable: h.traumaBaysAvailable,
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
      rawResults.push(...dbResults);
    }

    // 3. Fallback: If TomTom and DB returned 0 results, query OSM Overpass with safety timeout
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

  // Deduplication, Eligibility Assessment & Exact Straight-Line Radius Enforcement
  const normalizedMap = new Map<string, NormalizedHospital>();
  const providerIdSet = new Set<string>();
  const spatialGrid = new Map<string, NormalizedHospital>();

  for (const raw of rawResults) {
    if (!raw.lat || !raw.lng || (raw.lat === 0 && raw.lng === 0)) continue;

    // Strict straight-line Haversine distance validation (exclude facilities beyond selected radius)
    const dist = Math.round(getDistanceMeters(centerLat, centerLng, raw.lat, raw.lng));
    if (dist > radiusMeters) continue;

    // Evaluate facility eligibility and verification tier
    const assessment = assessHospitalEligibility(
      raw.name,
      raw.provider,
      raw.emergencyCapable,
      raw.types || []
    );

    // If completely excluded (e.g. external pharmacy, veterinary clinic, dental office, Ayurveda spa)
    if (assessment.isExcludedFacility) continue;

    // Exact match deduplication by provider + providerId
    const provKey = `${raw.provider}_${raw.providerId}`;
    if (providerIdSet.has(provKey)) continue;

    // Spatial proximity deduplication (~35m cell bucket)
    const gridKey = `${Math.floor(raw.lat / 0.00035)}_${Math.floor(raw.lng / 0.00035)}`;
    const existing = spatialGrid.get(gridKey);
    if (
      existing &&
      (existing.name.toLowerCase() === raw.name.toLowerCase() ||
        getDistanceMeters(existing.lat, existing.lng, raw.lat, raw.lng) < 30)
    ) {
      // If the incoming facility is from the registered DB and existing is external, upgrade it
      if (raw.provider === 'db' && existing.provider !== 'db') {
        normalizedMap.delete(existing.id);
      } else {
        continue;
      }
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
      types: raw.types || ['hospital'],
      distanceMeters: dist,
      verificationTier: assessment.verificationTier,
      isEmergencyEligible: assessment.isEmergencyEligible,
      ineligibilityReason: assessment.ineligibilityReason,
      emergencyCapable: raw.emergencyCapable,
      totalBeds: raw.totalBeds,
      availableIcuBeds: raw.availableIcuBeds,
      traumaBaysAvailable: raw.traumaBaysAvailable,
    };

    spatialGrid.set(gridKey, hospital);
    normalizedMap.set(internalId, hospital);
  }

  // Sort:
  // 1. Eligible verified emergency hospitals first, sorted by distance
  // 2. Then registered non-acute hospitals, sorted by distance
  // 3. Then unverified external facilities, sorted by distance
  const finalList = Array.from(normalizedMap.values()).sort((a, b) => {
    if (a.isEmergencyEligible !== b.isEmergencyEligible) {
      return a.isEmergencyEligible ? -1 : 1;
    }
    return a.distanceMeters - b.distanceMeters;
  });

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
      if (!raw.lat || !raw.lng || (raw.lat === 0 && raw.lng === 0)) continue;
      const dist = Math.round(getDistanceMeters(centerLat, centerLng, raw.lat, raw.lng));

      if (dist > radiusMeters * 1.05) continue;

      const assessment = assessHospitalEligibility(
        raw.name,
        raw.provider || 'tomtom',
        raw.emergencyCapable,
        raw.types || []
      );

      if (assessment.isExcludedFacility) continue;

      const internalId = raw.id || `${raw.provider}_${raw.providerId}`;
      normalizedMap.set(internalId, {
        ...raw,
        id: internalId,
        distanceMeters: dist,
        verificationTier: assessment.verificationTier,
        isEmergencyEligible: assessment.isEmergencyEligible,
        ineligibilityReason: assessment.ineligibilityReason,
      });
    }

    const finalList = Array.from(normalizedMap.values()).sort((a, b) => {
      if (a.isEmergencyEligible !== b.isEmergencyEligible) {
        return a.isEmergencyEligible ? -1 : 1;
      }
      return (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0);
    });

    searchCache.set(cacheKey, { data: finalList, timestamp: Date.now() });
    return { radius: radiusMeters, results: finalList };
  } catch (err: any) {
    if (err.name === 'AbortError') return { radius: radiusMeters, results: [] };
    console.error('[HospitalSearch] Text search failed:', err);
    throw err;
  }
}
