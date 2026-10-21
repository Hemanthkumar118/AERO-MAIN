import type { RouteInfo, LatLng } from '../types';
import { routingService } from './routingService';
import { ROUTING_CONFIG } from './routingConfig';
import { getBackendUrl } from './apiConfig';

export interface RoutingOptions {
  provider?: 'tomtom' | 'ors' | 'osrm';
}

export class RoutingProvider {
  /**
   * Decodes a Google-style/ORS Polyline5 string into an array of [lat, lng] coordinates.
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
   * Fetch route from backend which handles ORS and OSRM fallback.
   */
  static async getRoute(
    origin: LatLng | [number, number],
    destination: LatLng | [number, number],
    options: RoutingOptions = {}
  ): Promise<RouteInfo> {
    const originCoords = Array.isArray(origin) ? origin : [origin.latitude, origin.longitude];
    const destCoords = Array.isArray(destination) ? destination : [destination.latitude, destination.longitude];

    const provider = options.provider || ROUTING_CONFIG.PRIMARY_PROVIDER;

    try {
      const backendUrl = getBackendUrl();
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
        // Decode polyline into array of [lat, lng] if it's a string, or use directly if array
        let decodedPolyline: [number, number][] = [];
        if (typeof data.polyline === 'string') {
           decodedPolyline = RoutingProvider.decodePolyline(data.polyline, 5);
        } else if (Array.isArray(data.polyline)) {
           // Assume it's already an array of coordinates (GeoJSON LineString coords are [lng, lat], we need [lat, lng])
           // Or the backend normalized it. Let's assume backend normalizes it to Google's polyline string format or [lat, lng] array.
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
            congestionSegments: []
          };
        }
      }
    } catch (err) {
      console.warn('[AERO ROUTING] Backend route failed, falling back to local OSRM:', err);
    }

    // Final Fallback to local OSRM if backend is completely down
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
    const refreshInterval = ROUTING_CONFIG.ROUTE_REFRESH_INTERVAL;
    
    // Reroute if the data is stale
    if (now - lastCalculationTime > refreshInterval) {
      return true;
    }

    return false;
  }
}
