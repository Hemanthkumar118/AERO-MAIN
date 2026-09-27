import type { RawHospitalResult } from './types';

// Overpass API public endpoint (use responsibly)
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export async function searchOSMOverpass(
  lat: number,
  lng: number,
  radiusMeters: number,
  signal: AbortSignal
): Promise<RawHospitalResult[]> {
  const results: RawHospitalResult[] = [];

  // Query for nodes, ways, and relations tagged as hospital, clinic, or doctors within radius
  const query = `
    [out:json][timeout:30];
    (
      node["amenity"~"hospital|clinic|doctors"](around:${radiusMeters},${lat},${lng});
      way["amenity"~"hospital|clinic|doctors"](around:${radiusMeters},${lat},${lng});
      relation["amenity"~"hospital|clinic|doctors"](around:${radiusMeters},${lat},${lng});
      node["healthcare"~"hospital|clinic|doctor"](around:${radiusMeters},${lat},${lng});
      way["healthcare"~"hospital|clinic|doctor"](around:${radiusMeters},${lat},${lng});
      relation["healthcare"~"hospital|clinic|doctor"](around:${radiusMeters},${lat},${lng});
    );
    out center;
  `;

  try {
    // Combine component unmount signal with a 30s timeout
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 30000);
    
    const onAbort = () => timeoutController.abort();
    signal.addEventListener('abort', onAbort);

    const response = await fetch(`${OVERPASS_URL}?data=${encodeURIComponent(query.trim())}`, {
      method: 'GET',
      headers: {
        'Accept': '*/*'
      },
      signal: timeoutController.signal
    });
    
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onAbort);

    if (!response.ok) {
      console.warn(`[OSMProvider] Overpass API failed with status ${response.status}`);
      return results;
    }

    const data = await response.json();
    const elements = data.elements || [];

    for (const el of elements) {
      const elLat = el.lat || el.center?.lat;
      const elLng = el.lon || el.center?.lon;
      
      if (!elLat || !elLng) continue;

      const tags = el.tags || {};
      const name = tags.name || tags['name:en'] || 'Unknown Facility (OSM)';
      
      const type = tags.amenity || 'hospital';

      results.push({
        providerId: `osm_${el.type}_${el.id}`,
        provider: 'osm',
        name: name,
        lat: elLat,
        lng: elLng,
        address: [tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ') || undefined,
        phone: tags.phone || tags['contact:phone'] || undefined,
        types: [type]
      });
    }

  } catch (err: any) {
    if (err.name === 'AbortError') throw err;
    console.warn(`[OSMProvider] Error during Overpass Search:`, err);
  }

  return results;
}
