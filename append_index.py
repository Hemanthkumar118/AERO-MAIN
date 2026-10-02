import sys

with open('src/services/hospitalSearch/index.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Add import
content = content.replace(
    "import { searchGooglePlacesSingle } from './googleProvider';",
    "import { searchGooglePlacesSingle, searchGooglePlacesByText } from './googleProvider';"
)

# Add searchHospitalsByText function
new_func = '''
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
    searchCache.set(cacheKey, { data: finalList, timestamp: Date.now() });

    return { radius: radiusMeters, results: finalList };
  } catch (err: any) {
    console.error("[HospitalSearch] Text search failed:", err);
    throw err;
  }
}
'''

content += new_func

with open('src/services/hospitalSearch/index.ts', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
