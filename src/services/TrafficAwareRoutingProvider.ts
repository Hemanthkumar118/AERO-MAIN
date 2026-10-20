import type { RouteInfo, LatLng } from '../types';
import { routingService } from './routingService';

export interface TrafficRoutingOptions {
  provider?: 'tomtom' | 'google' | 'ors' | 'osrm';
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
   * Uses TomTom Routes API via backend proxy, with ORS/OSRM as fallback.
   */
  static async getFastestRoute(
    origin: LatLng | [number, number],
    destination: LatLng | [number, number],
    options: TrafficRoutingOptions = {}
  ): Promise<RouteInfo> {
    const originCoords = Array.isArray(origin) ? origin : [origin.latitude, origin.longitude];
    const destCoords = Array.isArray(destination) ? destination : [destination.latitude, destination.longitude];

    const configuredProvider = (import.meta.env.VITE_ROUTING_PROVIDER || 'tomtom') as 'tomtom' | 'google' | 'ors' | 'osrm';
    const provider = options.provider || configuredProvider;

    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      const response = await fetch(`${backendUrl}/api/route/calculate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          origin: { lat: originCoords[0], lng: originCoords[1] },
          destination: { lat: destCoords[0], lng: destCoords[1] },
          provider
        })
      });

      const data = await response.json();
      
      if (response.ok && data.success && data.polyline) {
        let decodedPolyline: [number, number][] = [];
        if (typeof data.polyline === 'string') {
          decodedPolyline = TrafficAwareRoutingProvider.decodePolyline(data.polyline, 5);
        } else if (Array.isArray(data.polyline)) {
          decodedPolyline = data.polyline;
        }
        
        if (decodedPolyline && Array.isArray(decodedPolyline) && decodedPolyline.length > 0) {
          return {
            polyline: decodedPolyline,
            distanceMeters: data.distanceMeters,
            etaSeconds: data.durationSeconds,
            trafficAwareEtaSeconds: data.isTrafficAware ? data.durationSeconds : undefined,
            staticEtaSeconds: data.staticDurationSeconds,
            trafficDelaySeconds: data.trafficDelaySeconds || 0,
            isTrafficAware: Boolean(data.isTrafficAware),
            trafficStatus: data.trafficStatus || (data.isTrafficAware ? 'LIVE' : 'UNAVAILABLE'),
            routeProvider: data.provider || provider,
            calculatedAt: data.calculatedAt || new Date().toISOString(),
            congestionSegments: data.congestionSegments || [],
            routeIncidents: data.routeIncidents || [],
            alternatives: data.alternatives || []
          };
        }
      }
    } catch (err) {
      console.warn('[AERO ROUTING] Backend route failed, falling back to local OSRM:', err);
    }

    // Fallback or default to local OSRM
    const osrmRoute = await routingService.getLiveRoute(originCoords as [number, number], destCoords as [number, number]);
    
    return {
      ...osrmRoute,
      isTrafficAware: false,
      trafficStatus: 'UNAVAILABLE',
      routeProvider: 'osrm',
      calculatedAt: new Date().toISOString()
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
