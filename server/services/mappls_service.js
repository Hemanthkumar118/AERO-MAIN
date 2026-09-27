export class MapplsService {
  async getTrafficAwareRoute(origin, destination) {
    const apiKey = process.env.MAPPLS_API_KEY;
    if (!apiKey) {
      throw new Error('MAPPLS_API_KEY is missing');
    }

    // Format: lng,lat
    const start = `${origin.lng},${origin.lat}`;
    const end = `${destination.lng},${destination.lat}`;
    
    // rtype=1 for fastest route, alternatives=true for alternate routes, geometries=polyline
    const url = `https://apis.mappls.com/advancedmaps/v1/${apiKey}/route_adv/driving/${start};${end}?alternatives=true&steps=true&geometries=polyline&rtype=1`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Mappls API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('No routes found from Mappls');
    }

    // Process all alternatives
    const processedRoutes = data.routes.map((route, index) => {
      // Calculate congestion segments from steps
      const congestionSegments = [];
      
      if (route.legs && route.legs.length > 0) {
        route.legs.forEach(leg => {
          if (leg.steps && leg.steps.length > 0) {
            leg.steps.forEach(step => {
              if (step.geometry && step.distance > 0 && step.duration > 0) {
                // Calculate speed in km/h
                const speedKmh = (step.distance / 1000) / (step.duration / 3600);
                
                let level = 'green';
                if (speedKmh < 15) level = 'red';
                else if (speedKmh < 30) level = 'orange';
                else if (speedKmh < 45) level = 'yellow';
                
                congestionSegments.push({
                  polylineString: step.geometry,
                  level: level,
                  speedKmh: speedKmh
                });
              }
            });
          }
        });
      }

      return {
        id: `route_${Date.now()}_${index}`,
        polylineString: route.geometry,
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        trafficAwareDurationSeconds: route.duration, // Mappls incorporates traffic natively with route_adv
        trafficStatus: 'LIVE',
        etaSeconds: route.duration,
        congestionSegments: congestionSegments,
        isPrimary: index === 0
      };
    });

    return processedRoutes;
  }
}
