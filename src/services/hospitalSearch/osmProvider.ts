import type { RawHospitalResult } from './types';

export async function searchOSMOverpass(
  lat: number,
  lng: number,
  radiusMeters: number,
  signal: AbortSignal
): Promise<RawHospitalResult[]> {
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
      relation["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
      node["amenity"="clinic"](around:${radiusMeters},${lat},${lng});
      way["amenity"="clinic"](around:${radiusMeters},${lat},${lng});
      relation["amenity"="clinic"](around:${radiusMeters},${lat},${lng});
    );
    out center;
  `;

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://z.overpass-api.de/api/interpreter'
  ];

  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: query,
        signal
      });

      if (!response.ok) {
        throw new Error(`OSM Overpass API error from ${endpoint}: ${response.status}`);
      }

      const data = await response.json();
      const results: RawHospitalResult[] = [];

      if (data && data.elements) {
        for (const el of data.elements) {
          const resultLat = el.lat || el.center?.lat;
          const resultLng = el.lon || el.center?.lon;
          
          if (resultLat && resultLng) {
            const name = el.tags?.name || el.tags?.['name:en'] || 'Unknown Hospital';
            results.push({
              providerId: `osm_${el.id}`,
              provider: 'osm',
              name: name,
              lat: resultLat,
              lng: resultLng,
              address: el.tags?.['addr:full'] || el.tags?.['addr:street'] || undefined,
              phone: el.tags?.phone || el.tags?.['contact:phone'] || undefined,
              types: ['hospital'],
            });
          }
        }
      }

      return results;
    } catch (error) {
      lastError = error;
      if ((error as any).name === 'AbortError') {
        return [];
      }
      console.warn(`[OSMProvider] Endpoint ${endpoint} failed:`, error);
      // Try next endpoint
    }
  }

  console.error("[OSMProvider] All endpoints failed. Last error:", lastError);
  return [];
}
