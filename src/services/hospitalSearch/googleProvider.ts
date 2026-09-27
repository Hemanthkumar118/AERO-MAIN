import type { RawHospitalResult } from './types';
import { supabase } from '../../lib/supabase';


export async function searchGooglePlacesSingle(
  lat: number,
  lng: number,
  radiusMeters: number,
  query: string | undefined,
  signal: AbortSignal
): Promise<RawHospitalResult[]> {
  const results: RawHospitalResult[] = [];
  const seenIds = new Set<string>();

  try {
    if (signal.aborted) return results;

    const body: any = { latitude: lat, longitude: lng };
    // If it's a nearby search, limit radius (Places API maxes at 50,000 for some operations)
    body.radius = Math.min(radiusMeters, 50000);

    if (query && query.trim().length >= 2) {
      body.query = query.trim();
    } else {
      body.type = 'hospital';
    }

    const { data, error } = await supabase.functions.invoke('search-hospitals', {
      body
    });

    if (error || !data) {
      console.warn(`[GoogleProvider] Search failed:`, error?.message);
      throw new Error(`Google API Request Failed: ${error?.message || 'No data'}`);
    }

    if (data.error) {
      console.warn(`[GoogleProvider] API error:`, data.error, data.details);
      throw new Error(`Google Places API Error: ${data.error}`);
    }

    const places = data.places || [];
    for (const place of places) {
      const id = place.id;
      if (!id || seenIds.has(id)) continue;
      
      seenIds.add(id);
      results.push({
        providerId: id,
        provider: 'google',
        name: place.displayName?.text || 'Unknown Facility',
        lat: place.location?.latitude,
        lng: place.location?.longitude,
        address: place.formattedAddress,
        types: place.primaryType ? [place.primaryType] : (place.types || [])
      });
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.warn(`[GoogleProvider] Error during Search:`, err);
    } else {
      throw err;
    }
  }

  return results;
}
