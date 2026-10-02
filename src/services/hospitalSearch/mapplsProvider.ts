import type { NormalizedHospital } from './types';

export async function searchMappls(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  query?: string,
  signal?: AbortSignal
): Promise<NormalizedHospital[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }

    // Ensure Mappls is loaded
    const mappls = (window as any).mappls;
    if (!mappls) {
      console.error("[MapplsProvider] Mappls SDK not loaded on window.");
      return resolve([]); // Gracefully fail
    }

    try {
      const options = {
        keyword: query || 'hospital',
        filter: 'cop:HOS',
        refLocation: [centerLat, centerLng],
        radius: radiusMeters,
        callback: async function (data: any) {
          console.log("[MapplsProvider] Raw Nearby Response:", data);
          if (!data || !Array.isArray(data)) {
            console.warn("[MapplsProvider] Empty or invalid response from Mappls Nearby");
            return resolve([]);
          }

          const hospitalsPromise = data.map(async (place: any, index: number) => {
            // Mappls Nearby might return latitude/longitude, lat/lng, or they might be nested.
            // Let's defensively parse coordinates.
            let lat = parseFloat(place.latitude || place.lat);
            let lng = parseFloat(place.longitude || place.lng);
            
            // If missing, try location object if it exists
            if (Number.isNaN(lat) || Number.isNaN(lng)) {
               if (place.location && typeof place.location.lat !== 'undefined') {
                 lat = parseFloat(place.location.lat);
                 lng = parseFloat(place.location.lng);
               } else if (place.geometry && place.geometry.location) {
                 lat = parseFloat(place.geometry.location.lat);
                 lng = parseFloat(place.geometry.location.lng);
               }
            }

            // Fallback: try to fetch from Place Details if we have eLoc
            if ((Number.isNaN(lat) || Number.isNaN(lng)) && place.eLoc) {
               console.log(`[MapplsProvider] Coordinates missing for ${place.placeName}, attempting getPinDetails for ${place.eLoc}`);
               try {
                  const details = await new Promise<any>((res) => {
                     const cb = (d: any) => res(d);
                     if (typeof mappls.getPinDetails === 'function') {
                        mappls.getPinDetails({ pin: place.eLoc }, cb);
                     } else if (typeof mappls.pinDetails === 'function') {
                        mappls.pinDetails({ pin: place.eLoc }, cb);
                     } else {
                        res(null);
                     }
                  });
                  if (details) {
                     lat = parseFloat(details.latitude || details.lat);
                     lng = parseFloat(details.longitude || details.lng);
                  }
               } catch (e) {
                  console.warn(`[MapplsProvider] Failed to fetch details for ${place.eLoc}`, e);
               }
            }

            // Ultimate fallback to center if completely missing to avoid NaN crashing the app
            if (Number.isNaN(lat)) lat = centerLat + (Math.random() - 0.5) * 0.005; // tiny scatter
            if (Number.isNaN(lng)) lng = centerLng + (Math.random() - 0.5) * 0.005;

            return {
              id: place.eLoc || `mappls-${index}`,
              providerId: place.eLoc || `mappls-${index}`,
              provider: 'mappls' as const,
              name: place.placeName || place.poi || place.name || 'Unknown Hospital',
              lat,
              lng,
              address: place.placeAddress || place.address || '',
              phone: place.phone || undefined,
              types: ['hospital'],
              // Force use the distance provided by Mappls in meters
              distanceMeters: place.distance ? parseFloat(place.distance) : undefined
            } as NormalizedHospital;
          });

          const hospitals = await Promise.all(hospitalsPromise);

          // Filter out anything extremely far if we want, but radius handles it.
          resolve(hospitals);
        }
      };

      console.log(`[MapplsProvider] Initiating nearby search...`, options);
      mappls.nearby(options);
      
      if (signal) {
        signal.addEventListener('abort', () => {
           // Mappls SDK doesn't have an abort, but we can reject the promise
           reject(new DOMException('Aborted', 'AbortError'));
        });
      }
    } catch (err) {
      console.error("[MapplsProvider] Error during nearby search:", err);
      resolve([]);
    }
  });
}
