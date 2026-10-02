/**
 * AERO Google Routes Service
 * Computes traffic-aware routes using Google Routes API.
 * Falls back to OSRM if Google Routes is unavailable.
 */
export class GoogleRoutesService {
  async getTrafficAwareRoute(origin, destination) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY is missing');
    }

    try {
      // Use Google Routes API (computeRoutes)
      const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';

      const requestBody = {
        origin: {
          location: {
            latLng: {
              latitude: origin.lat,
              longitude: origin.lng
            }
          }
        },
        destination: {
          location: {
            latLng: {
              latitude: destination.lat,
              longitude: destination.lng
            }
          }
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        computeAlternativeRoutes: true,
        routeModifiers: {
          avoidTolls: false,
          avoidHighways: false,
          avoidFerries: true
        },
        languageCode: 'en-US',
        units: 'METRIC'
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.navigationInstruction'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[GoogleRoutes] API error: ${response.status}`, errorText);
        throw new Error(`Google Routes API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.routes || data.routes.length === 0) {
        throw new Error('No routes found from Google Routes API');
      }

      // Process all routes
      const processedRoutes = data.routes.map((route, index) => {
        // Parse duration string (e.g., "1234s") to seconds
        const durationStr = route.duration || '0s';
        const durationSeconds = parseInt(durationStr.replace('s', '')) || 0;

        // Calculate congestion segments from steps
        const congestionSegments = [];

        if (route.legs && route.legs.length > 0) {
          route.legs.forEach(leg => {
            if (leg.steps && leg.steps.length > 0) {
              leg.steps.forEach(step => {
                if (step.polyline?.encodedPolyline && step.distanceMeters > 0) {
                  const stepDuration = parseInt((step.staticDuration || '0s').replace('s', '')) || 0;
                  
                  if (stepDuration > 0) {
                    // Calculate speed in km/h
                    const speedKmh = (step.distanceMeters / 1000) / (stepDuration / 3600);

                    let level = 'green';
                    if (speedKmh < 15) level = 'red';
                    else if (speedKmh < 30) level = 'orange';
                    else if (speedKmh < 45) level = 'yellow';

                    congestionSegments.push({
                      polylineString: step.polyline.encodedPolyline,
                      level: level,
                      speedKmh: speedKmh
                    });
                  }
                }
              });
            }
          });
        }

        return {
          id: `route_${Date.now()}_${index}`,
          polylineString: route.polyline?.encodedPolyline || '',
          distanceMeters: route.distanceMeters || 0,
          durationSeconds: durationSeconds,
          trafficAwareDurationSeconds: durationSeconds, // Google Routes natively includes traffic
          trafficStatus: 'LIVE',
          etaSeconds: durationSeconds,
          congestionSegments: congestionSegments,
          isPrimary: index === 0
        };
      });

      return processedRoutes;
    } catch (err) {
      console.warn('[GoogleRoutes] Primary route failed, falling back to OSRM:', err.message);
      
      // Fallback to OSRM
      return this.getOSRMRoute(origin, destination);
    }
  }

  async getOSRMRoute(origin, destination) {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=polyline&steps=true&alternatives=true`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OSRM API error: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('No routes found from OSRM');
    }

    return data.routes.map((route, index) => ({
      id: `route_${Date.now()}_${index}`,
      polylineString: route.geometry,
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      trafficAwareDurationSeconds: Math.round(route.duration),
      trafficStatus: 'UNAVAILABLE',
      etaSeconds: Math.round(route.duration),
      congestionSegments: [],
      isPrimary: index === 0
    }));
  }
}
