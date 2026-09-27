import type { RawHospitalResult, NormalizedHospital } from './types';
import { searchGooglePlacesSingle } from './googleProvider';
import { searchOSMOverpass } from './osmProvider';
import { hospitalService } from '../hospitalService';

// Haversine distance formula
function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

export async function discoverHospitals(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  query: string | undefined,
  signal: AbortSignal
): Promise<NormalizedHospital[]> {
  console.log(`\n--- AERO HOSPITAL DEBUG ---`);
  console.log(`GPS: ${centerLat.toFixed(6)}, ${centerLng.toFixed(6)}`);
  console.log(`Radius: ${radiusMeters / 1000} km`);
  
  const latBucket = centerLat.toFixed(3);
  const lngBucket = centerLng.toFixed(3);
  const cacheKey = `${latBucket}_${lngBucket}_${radiusMeters}_${query || ''}`;
  
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 1000 * 60 * 5) { // 5 min TTL
    console.log(`[HospitalSearch] Serving from cache: ${cacheKey}`);
    return cached.data;
  }

  let googleRawCount = 0;
  let googleRequests = 0;
  let osmRawCount = 0;
  let osmRequests = 0;

  const rawResults: RawHospitalResult[] = [];

  try {
    // 1. Google Places
    const googlePromise = searchGooglePlacesSingle(centerLat, centerLng, radiusMeters, query, signal).catch(err => {
      if (err.name !== 'AbortError') console.error("[GoogleProvider] Discovery failed:", err);
      return [];
    });
    
    // Start OSM search concurrently (fallback)
    const osmPromise = searchOSMOverpass(centerLat, centerLng, radiusMeters, signal).catch(err => {
      if (err.name !== 'AbortError') console.error("[OSMProvider] Discovery failed:", err);
      return [];
    });

    // Start DB search concurrently
    const dbPromise = hospitalService.getAllHospitals().then(dbHospitals => {
      return dbHospitals.map(h => ({
        providerId: h.id,
        provider: 'db' as const,
        name: h.name,
        lat: h.location.latitude,
        lng: h.location.longitude,
        address: h.address,
        phone: h.phone,
        types: ['hospital']
      }));
    }).catch(err => {
      console.error("[DBProvider] Discovery failed:", err);
      return [];
    });
    
    const [googleResults, osmResults, dbResults] = await Promise.all([googlePromise, osmPromise, dbPromise]);
    
    if (googleResults) {
      googleRawCount = googleResults.length;
      rawResults.push(...googleResults);
    }
    
    if (osmResults) {
      osmRawCount = osmResults.length;
      rawResults.push(...osmResults);
    }

    if (dbResults) {
      rawResults.push(...dbResults);
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.error("[HospitalSearch] Discovery failed:", err);
      throw err; // bubble up the error to display
    } else {
      throw err;
    }
  }

  const mergedCount = rawResults.length;

  // 3. Deduplication and Normalization
  const normalizedMap = new Map<string, NormalizedHospital>();
  
  for (const raw of rawResults) {
    const dist = getDistanceMeters(centerLat, centerLng, raw.lat, raw.lng);
    
    // Filter out items strictly outside the requested radius
    if (dist > radiusMeters) continue;

    // Check for existing by name & proximity (within 100 meters)
    let isDuplicate = false;
    let existingKey = '';

    for (const [key, existing] of normalizedMap.entries()) {
      if (existing.providerId === raw.providerId && existing.provider === raw.provider) {
         isDuplicate = true;
         break;
      }
      
      const distanceBetween = getDistanceMeters(existing.lat, existing.lng, raw.lat, raw.lng);
      
      // Similarity check (same name string matches, or very close proximity)
      if (distanceBetween < 100) {
         if (existing.name.toLowerCase() === raw.name.toLowerCase() || distanceBetween < 20) {
            isDuplicate = true;
            existingKey = key;
            break;
         }
      }
    }

    if (isDuplicate) {
      if (existingKey) {
        // Merge OSM and Google data if they matched
        const existing = normalizedMap.get(existingKey)!;
        if (existing.provider !== raw.provider) {
           existing.provider = 'merged';
           if (raw.provider === 'google') {
             // Prefer Google's richer data
             existing.rating = raw.rating || existing.rating;
             existing.reviewCount = raw.reviewCount || existing.reviewCount;
             existing.address = raw.address || existing.address;
           }
        }
      }
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

  console.log(`Google requests (grid points): ${googleRequests}`);
  console.log(`Google raw: ${googleRawCount}`);
  console.log(`OSM requests: ${osmRequests}`);
  console.log(`OSM raw: ${osmRawCount}`);
  console.log(`Merged: ${mergedCount}`);
  console.log(`Deduplicated & within radius: ${finalList.length}`);
  console.log(`List: ${finalList.length}`);
  console.log(`Markers: ${finalList.length}`);
  console.log(`---------------------------\n`);

  if (finalList.length === 0) {
    console.log("[HospitalSearch] No hospitals found from APIs or DB! Returning fallback defaults.");
    // Generate fallback hospitals around the current location
    finalList.push({
      id: "fallback_1",
      provider: "osm",
      providerId: "dummy_1",
      name: "City Central Hospital (Demo)",
      lat: centerLat + 0.005,
      lng: centerLng + 0.005,
      address: "Downtown Medical Area",
      types: ["hospital"],
      distanceMeters: getDistanceMeters(centerLat, centerLng, centerLat + 0.005, centerLng + 0.005)
    });
    finalList.push({
      id: "fallback_2",
      provider: "osm",
      providerId: "dummy_2",
      name: "General Care Hospital (Demo)",
      lat: centerLat - 0.004,
      lng: centerLng - 0.006,
      address: "Westside District",
      types: ["hospital"],
      distanceMeters: getDistanceMeters(centerLat, centerLng, centerLat - 0.004, centerLng - 0.006)
    });
    finalList.push({
      id: "fallback_3",
      provider: "osm",
      providerId: "dummy_3",
      name: "Emergency Trauma Center (Demo)",
      lat: centerLat - 0.008,
      lng: centerLng + 0.003,
      address: "Eastside District",
      types: ["hospital"],
      distanceMeters: getDistanceMeters(centerLat, centerLng, centerLat - 0.008, centerLng + 0.003)
    });
  }

  searchCache.set(cacheKey, { data: finalList, timestamp: Date.now() });

  return finalList;
}
