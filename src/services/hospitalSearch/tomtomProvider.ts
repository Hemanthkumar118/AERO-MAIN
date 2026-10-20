import type { NormalizedHospital } from './types';

/**
 * Discovers nearby hospitals using TomTom Places/POI Search API via backend proxy
 */
export async function searchTomTomHospitals(
  lat: number,
  lng: number,
  radiusMeters: number = 15000,
  signal?: AbortSignal,
  query?: string
): Promise<NormalizedHospital[]> {
  try {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
    let url = `${backendUrl}/api/places/hospitals?lat=${lat}&lng=${lng}&radius=${radiusMeters}`;
    if (query && query.trim()) {
      url += `&query=${encodeURIComponent(query.trim())}`;
    }

    const res = await fetch(url, { signal });

    if (!res.ok) {
      throw new Error(`TomTom Places proxy failed with status: ${res.status}`);
    }

    const data = await res.json();
    if (data.success && Array.isArray(data.results)) {
      return data.results;
    }
    return [];
  } catch (err: any) {
    if (err.name === 'AbortError') return [];
    console.warn('[TomTomProvider] POI Hospital search error:', err.message || err);
    return [];
  }
}
