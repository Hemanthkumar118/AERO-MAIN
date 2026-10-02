import sys
with open('src/services/hospitalSearch/googleProvider.ts', 'a', encoding='utf-8') as f:
    f.write('''
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

    if (window.google?.maps?.places?.Place?.searchByText) {
      console.log(`[GoogleProvider] Querying Google Places API (New) JS TEXT SEARCH for: ${query}`);
      const { Place } = window.google.maps.places;
      
      const request = {
          textQuery: query.trim(),
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
          includedType: "hospital",
          useStrictTypeFiltering: true,
          locationBias: {
              circle: {
                  center: { lat, lng },
                  radius: Math.min(radiusMeters, 50000)
              }
          },
          maxResultCount: 20
      };

      const { places } = await Place.searchByText(request);
      
      for (const place of places) {
        const isHospital = place.primaryType === 'hospital' || (place.types && place.types.includes('hospital'));
        if (!isHospital) continue;

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
''')
