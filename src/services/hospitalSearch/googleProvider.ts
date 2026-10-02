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

    // Use the Maps JS API (New) if available
    if (typeof window.google?.maps?.places?.Place?.searchNearby === 'function' && !query) {
      console.log(`[GoogleProvider] Querying Google Places API (New) JS for hospitals...`);
      const { Place } = window.google.maps.places;
      
      const request = {
          fields: [
              "displayName",
              "location",
              "formattedAddress",
              "googleMapsURI",
              "primaryType",
              "types",
              "id",
              "nationalPhoneNumber",
              "businessStatus"
          ],
          locationRestriction: {
              center: { lat, lng },
              radius: Math.min(radiusMeters, 50000)
          },
          includedPrimaryTypes: ["hospital"],
          maxResultCount: 20,
          rankPreference: window.google.maps.places.SearchNearbyRankPreference.DISTANCE
      };

      const { places } = await Place.searchNearby(request);
      
      for (const place of places) {
        const id = place.id;
        if (!id || seenIds.has(id)) continue;
        
        seenIds.add(id);
        results.push({
          providerId: id,
          provider: "google",
          name: place.displayName || "Unknown Facility",
          lat: place.location?.lat() || 0,
          lng: place.location?.lng() || 0,
          address: place.formattedAddress || "",
          phone: place.nationalPhoneNumber || "",
          googleMapsUri: place.googleMapsURI || "",
          businessStatus: place.businessStatus || "",
          types: place.primaryType ? [place.primaryType] : (place.types || [])
        });
      }
      
      return results;
    }

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
        phone: place.nationalPhoneNumber,
        googleMapsUri: place.googleMapsUri,
        businessStatus: place.businessStatus,
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

export async function autocompleteGooglePlaces(query: string, lat: number, lng: number, radiusMeters: number): Promise<any[]> {
  try {
    if (!query || query.trim().length < 2) return [];

    const { data, error } = await supabase.functions.invoke('search-hospitals', {
      body: {
        action: 'autocomplete',
        query: query.trim(),
        latitude: lat,
        longitude: lng,
        radius: Math.min(radiusMeters, 50000)
      }
    });

    if (error || !data || data.error) {
      console.warn(`[GoogleProvider] Autocomplete failed:`, error?.message || data?.error);
      return [];
    }

    return data.suggestions || [];
  } catch (err) {
    console.warn(`[GoogleProvider] Error during Autocomplete:`, err);
    return [];
  }
}

export async function getGooglePlaceDetails(placeId: string): Promise<RawHospitalResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke('search-hospitals', {
      body: {
        action: 'details',
        placeId,
        latitude: 0,
        longitude: 0 // dummy, required by current edge function validation
      }
    });

    if (error || !data || data.error) {
      console.warn(`[GoogleProvider] Place details failed:`, error?.message || data?.error);
      return null;
    }

    // data is the place object directly from places/{placeId} GET
    const place = data;
    if (!place || !place.id) return null;

    return {
      providerId: place.id,
      provider: 'google',
      name: place.displayName?.text || 'Unknown Facility',
      lat: place.location?.latitude,
      lng: place.location?.longitude,
      address: place.formattedAddress,
      phone: place.nationalPhoneNumber,
      googleMapsUri: place.googleMapsUri,
      businessStatus: place.businessStatus,
      types: place.primaryType ? [place.primaryType] : (place.types || [])
    };
  } catch (err) {
    console.warn(`[GoogleProvider] Error during Place Details:`, err);
    return null;
  }
}


export async function searchGooglePlacesByText(
  query: string,
  lat: number,
  lng: number,
  radiusMeters: number,
  signal: AbortSignal
): Promise<RawHospitalResult[]> {
  const results: RawHospitalResult[] = [];
  const seenIds = new Set<string>();

  try {
    if (signal.aborted) return results;
    if (!query || query.trim().length < 2) return results;

    if (window.google?.maps) {
      console.log(`[GoogleProvider] Querying Google Places API (New) JS TEXT SEARCH for: ${query}`);
      const { Place } = await window.google.maps.importLibrary("places") as any;
      
      if (!Place) {
         throw new Error("Google Maps Places library failed to load");
      }
      
      const request = {
          textQuery: query.trim(),
          fields: [
              "displayName",
              "location",
              "formattedAddress",
              "primaryType",
              "types",
              "businessStatus",
              "googleMapsURI"
          ],
          includedType: "hospital",
          useStrictTypeFiltering: true,
          locationBias: {
              center: { lat, lng },
              radius: Math.min(radiusMeters, 50000)
          },
          language: "en",
          maxResultCount: 20,
          region: "IN"
      };

      try {
        const response = await Place.searchByText(request);
        const places = Array.isArray(response?.places) ? response.places : [];
        
        for (const place of places) {
          if (!place) continue;

          // strict hospital check
          const primary = (place.primaryType || '').toLowerCase();
          const types = Array.isArray(place.types) ? place.types.map((t: any) => String(t).toLowerCase()) : [];
          
          if (primary !== 'hospital' && !types.includes('hospital')) continue;

          const nameRaw = typeof place.displayName === 'string' ? place.displayName : place.displayName?.text;
          if (!nameRaw) continue;
          const nameStr = String(nameRaw);

          const nameLower = nameStr.toLowerCase();
          const isClinicOrShop = 
            nameLower.includes('clinic') || nameLower.includes('pharmacy') || nameLower.includes('medical shop') || 
            nameLower.includes('dental') || nameLower.includes('diagnostic') || nameLower.includes('optical') ||
            nameLower.includes('dispensary') || nameLower.includes('dr.') || nameLower.includes('dr ') ||
            nameLower.includes('first aid') || nameLower.includes('health center') || nameLower.includes('physiotherapy') ||
            nameLower.includes('veterinary') || nameLower.includes('blood bank') || nameLower.includes('nursing home') ||
            nameLower.includes('wellness') || nameLower.includes('complex') || nameLower.includes('hsptl') ||
            nameLower.includes('store') || nameLower.includes('medicals') || nameLower.includes('scan') ||
            nameLower.includes('imaging') || nameLower.includes('x-ray') || nameLower.includes('xray') ||
            nameLower.includes('lab') || nameLower.includes('mri') || nameLower.includes('rehab') ||
            nameLower.includes('therapy') || nameLower.includes('ayurvedic') || nameLower.includes('homeopathic') ||
            nameLower.includes('unani') || nameLower.includes('skin') || nameLower.includes('hair') ||
            nameLower.includes('fertility') || nameLower.includes('maternity') || nameLower.includes('eye') ||
            nameLower.includes('vision') || nameLower.includes('optics') || nameLower.includes('opticals');

          if (
            isClinicOrShop ||
            types.includes('pharmacy') || types.includes('dentist') || types.includes('medical_clinic') || 
            types.includes('doctor') || types.includes('veterinary_care') || types.includes('physiotherapist') || 
            types.includes('store') || types.includes('shopping_mall') || types.includes('locality') ||
            types.includes('sublocality') || types.includes('drugstore')
          ) {
             continue;
          }

          const id = place.id;
          if (!id || seenIds.has(id)) continue;

          let pLat = 0;
          let pLng = 0;
          if (place.location) {
             pLat = typeof place.location.lat === 'function' ? place.location.lat() : (place.location.lat ?? place.location.latitude ?? 0);
             pLng = typeof place.location.lng === 'function' ? place.location.lng() : (place.location.lng ?? place.location.longitude ?? 0);
          }
          if (!pLat || !pLng || !Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;

          seenIds.add(id);
          results.push({
            providerId: id,
            provider: 'google',
            name: nameStr.trim(),
            lat: pLat,
            lng: pLng,
            address: typeof place.formattedAddress === 'string' ? place.formattedAddress : (place.formattedAddress as any)?.text || String(place.formattedAddress || ''),
            phone: place.nationalPhoneNumber || '',
            googleMapsUri: place.googleMapsURI ?? null,
            businessStatus: place.businessStatus ?? null,
            types: primary ? [primary] : types
          });
        }
        
        return results;
      } catch (error: any) {
         console.error("[Hospital Text Search] FAILED", {
            message: error?.message,
            name: error?.name,
            code: error?.code,
            status: error?.status,
            details: error
         });
         throw error;
      }
    }

    const body: any = { latitude: lat, longitude: lng, query: query.trim(), radius: Math.min(radiusMeters, 50000) };
    const { data, error } = await supabase.functions.invoke('search-hospitals', { body });

    if (error || !data || data.error) {
      console.warn(`[GoogleProvider] Text Search failed:`, error?.message || data?.error);
      throw new Error(`Google Places API Error: ${error?.message || data?.error}`);
    }

    const places = data.places || [];
    for (const place of places) {
      const isHospital = place.primaryType === 'hospital' || (place.types && place.types.includes('hospital'));
      if (!isHospital) continue;

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
        phone: place.nationalPhoneNumber,
        googleMapsUri: place.googleMapsUri,
        businessStatus: place.businessStatus,
        types: place.primaryType ? [place.primaryType] : (place.types || [])
      });
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.error(`[GoogleProvider] Error during Text Search:`, err);
      throw err;
    }
  }

  return results;
}
