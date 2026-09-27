import type { RouteInfo, LatLng } from '../types';
import { routingService } from './routingService';

export interface TrafficRoutingOptions {
  provider?: 'mappls' | 'google' | 'mapbox' | 'osrm';
  trafficAware?: boolean;
}

export class TrafficAwareRoutingProvider {
  /**
   * Decodes a Google-style Polyline5 string into an array of [lat, lng] coordinates.
   */
  static decodePolyline(str: string, precision: number = 5): [number, number][] {
    let index = 0;
    let lat = 0;
    let lng = 0;
    const coordinates: [number, number][] = [];
    const factor = Math.pow(10, precision);

    while (index < str.length) {
      let b;
      let shift = 0;
      let result = 0;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
      lng += dlng;

      coordinates.push([lat / factor, lng / factor]);
    }

    return coordinates;
  }

  /**
   * Fetch fastest route utilizing live traffic data if available.
   */
  static async getFastestRoute(
    origin: LatLng | [number, number],
    destination: LatLng | [number, number],
    options: TrafficRoutingOptions = {}
  ): Promise<RouteInfo> {
    const originCoords = Array.isArray(origin) ? origin : [origin.latitude, origin.longitude];
    const destCoords = Array.isArray(destination) ? destination : [destination.latitude, destination.longitude];

    // Check environment config for routing provider
    const configuredProvider = import.meta.env.VITE_ROUTING_PROVIDER || 'osrm';
    const provider = options.provider || configuredProvider;

    if (provider === 'mappls') {
      try {
        const baseUrl = import.meta.env.VITE_BACKEND_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');
        const response = await fetch(`${baseUrl}/api/route/calculate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            origin: { lat: originCoords[0], lng: originCoords[1] },
            destination: { lat: destCoords[0], lng: destCoords[1] }
          })
        });

        const data = await response.json();
        
        if (response.ok && data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          
          // Decode polylineString into array of [lat, lng]
          const decodedPolyline = TrafficAwareRoutingProvider.decodePolyline(route.polylineString, 5);
          
          if (decodedPolyline && Array.isArray(decodedPolyline)) {
            let parsedCongestion = [];
            if (route.congestionSegments && Array.isArray(route.congestionSegments)) {
              parsedCongestion = route.congestionSegments.map((seg: any) => ({
                polyline: TrafficAwareRoutingProvider.decodePolyline(seg.polylineString, 5),
                level: seg.level,
                speedKmh: seg.speedKmh
              })).filter((seg: any) => seg.polyline && seg.polyline.length > 0);
            }

            return {
              polyline: decodedPolyline,
              distanceMeters: route.distanceMeters,
              etaSeconds: route.durationSeconds,
              trafficAwareEtaSeconds: route.trafficAwareDurationSeconds,
              trafficStatus: 'LIVE',
              routeProvider: 'mappls',
              congestionSegments: parsedCongestion
            };
          }
        }
      } catch (err) {
        console.warn('[AERO ROUTING] Mappls backend route failed, falling back to OSRM:', err);
      }
    }

    // Fallback or default to OSRM
    const osrmRoute = await routingService.getLiveRoute(originCoords as [number, number], destCoords as [number, number]);
    
    return {
      ...osrmRoute,
      trafficStatus: 'UNAVAILABLE',
      routeProvider: 'osrm'
    };
  }

  /**
   * Determine if we need to recalculate the route based on GPS movement and time.
   */
  static shouldReroute(
    currentRoute: RouteInfo | null,
    lastCalculationTime: number,
    isOffRoute: boolean
  ): boolean {
    if (!currentRoute || currentRoute.polyline.length === 0) return true;
    if (isOffRoute) return true;

    const now = Date.now();
    const refreshInterval = parseInt(import.meta.env.VITE_TRAFFIC_REFRESH_SECONDS || '60') * 1000;
    
    // Reroute if the traffic data is stale
    if (now - lastCalculationTime > refreshInterval) {
      return true;
    }

    return false;
  }
}
