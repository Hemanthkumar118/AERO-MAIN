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

  // Create a bounding box query based on radius. 
  // ~111km per degree of latitude.
  const latDelta = radiusMeters / 111000;
  const lngDelta = radiusMeters / (111000 * Math.cos(lat * Math.PI / 180));

  const s = lat - latDelta;
  const n = lat + latDelta;
  const w = lng - lngDelta;
  const e = lng + lngDelta;

  try {
    // Query for nodes, ways, and relations tagged as hospital or healthcare=hospital
    const query = `
      [out:json][timeout:8];
      (
        node["amenity"="hospital"](${s},${w},${n},${e});
        way["amenity"="hospital"](${s},${w},${n},${e});
        node["healthcare"="hospital"](${s},${w},${n},${e});
        way["healthcare"="hospital"](${s},${w},${n},${e});
      );
      out center;
    `;

    // Timeout protection: 6s max
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 6000);
    
    const onAbort = () => timeoutController.abort();
    if (signal) signal.addEventListener('abort', onAbort);

    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AERO-Emergency-App/1.0 (emergency-routing@aero.local)',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: timeoutController.signal
    });
    
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);

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
