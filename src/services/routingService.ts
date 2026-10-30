/**
 * AERO Live Routing & OSRM OpenStreetMap Integration Service
 * Computes live driving corridors, polylines, and ETAs between any GPS coordinates.
 */

import type { RouteInfo, LatLng } from '../types';
import { toLeafletPos, toOsrmCoord, fromOsrmToLeaflet } from '../utils/coordinates';
import { getBackendUrl } from './apiConfig';

const routeCache = new Map<string, { data: RouteInfo, timestamp: number }>();

export const routingService = {
  /**
   * Fetch live real-world driving route using OpenStreetMap OSRM API
   */
  async getLiveRoute(
    origin: LatLng | [number, number],
    destination: LatLng | [number, number]
  ): Promise<RouteInfo> {
    const originOsrm = toOsrmCoord(origin);
    const destOsrm = toOsrmCoord(destination);
    const originLeaflet = toLeafletPos(origin);
    const destLeaflet = toLeafletPos(destination);

    const cacheKey = `${originOsrm[0].toFixed(4)},${originOsrm[1].toFixed(4)}_${destOsrm[0].toFixed(4)},${destOsrm[1].toFixed(4)}`;
    const cached = routeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 1000 * 60 * 5) {
      return cached.data;
    }

    try {
      // Use free OpenStreetMap OSRM routing engine (no API key required)
      const url = `https://router.project-osrm.org/route/v1/driving/${originOsrm[0]},${originOsrm[1]};${destOsrm[0]},${destOsrm[1]}?overview=full&geometries=geojson&steps=true`;
      
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });

      if (res.ok) {
        const data = await res.json();
        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          // GeoJSON coordinates are [lng, lat], convert to Leaflet [lat, lng]
          const polyline: [number, number][] = route.geometry.coordinates.map(
            (coord: [number, number]) => fromOsrmToLeaflet(coord)
          );

          const steps = route.legs?.[0]?.steps || [];

          const finalResult = {
            polyline,
            distanceMeters: Math.round(route.distance),
            etaSeconds: Math.round(route.duration),
            congestionSegments: [], // Mapbox returns congestion data differently, we will just use standard color for now
            steps,
          };
          routeCache.set(cacheKey, { data: finalResult, timestamp: Date.now() });
          return finalResult;
        }
      } else {
        console.warn(`[AERO ROUTING] HTTP error ${res.status} from routing engine`);
      }
    } catch (err: any) {
      console.warn(`[AERO ROUTING] Failed to fetch live route: ${err.message}`);
    }

    // Fallback: Approximate distance in meters using Haversine formula
    const originLat = originLeaflet[0];
    const originLng = originLeaflet[1];
    const destLat = destLeaflet[0];
    const destLng = destLeaflet[1];

    const R = 6371e3; // Earth radius in meters
    const dLat = ((destLat - originLat) * Math.PI) / 180;
    const dLng = ((destLng - originLng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((originLat * Math.PI) / 180) *
        Math.cos((destLat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distMeters = Math.round(R * c);
    const etaSecs = Math.round(distMeters / 15); // ~54 km/h average speed

    const fallbackResult = {
      polyline: [],
      distanceMeters: distMeters || 3800,
      etaSeconds: etaSecs || 310,
      congestionSegments: [],
    };
    routeCache.set(cacheKey, { data: fallbackResult, timestamp: Date.now() });
    return fallbackResult;
  },

  /**
   * Ranks an array of hospitals by actual driving travel time from the origin.
   * Primary metric: travel duration (ETA).
   * Secondary metric: driving distance.
   */
  async rankHospitalsByTravelTime(
    origin: LatLng | [number, number],
    hospitals: any[]
  ): Promise<any[]> {
    if (!hospitals || hospitals.length === 0) return [];
    
    // 1. Sort by straight-line distance first (which is usually fast and accurate enough for proximity filtering)
    const sortedByDistance = [...hospitals].sort((a, b) => a.distanceMeters - b.distanceMeters);
    
    // 2. Only run live routing on the top 5 closest to avoid OSRM rate limits
    const maxLiveRoutes = 5;
    const topCandidates = sortedByDistance.slice(0, maxLiveRoutes);
    const remainingCandidates = sortedByDistance.slice(maxLiveRoutes);

    // Process top candidates concurrently for much faster load times
    const routePromises = topCandidates.map(async (hospital) => {
      try {
        const dest: [number, number] = [hospital.lat, hospital.lng];
        let routeInfo: RouteInfo | null = null;
        try {
          const originCoords = Array.isArray(origin) ? origin : [origin.latitude, origin.longitude];
          const backendUrl = getBackendUrl();
          const res = await fetch(`${backendUrl}/api/route/calculate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              origin: { lat: originCoords[0], lng: originCoords[1] },
              destination: { lat: dest[0], lng: dest[1] },
              provider: 'tomtom'
            }),
            signal: AbortSignal.timeout(4000)
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.polyline) {
              const poly = Array.isArray(data.polyline) ? data.polyline : [];
              if (poly.length > 0) {
                routeInfo = {
                  polyline: poly,
                  distanceMeters: data.distanceMeters,
                  etaSeconds: data.durationSeconds,
                  trafficAwareEtaSeconds: data.durationSeconds,
                  staticEtaSeconds: data.staticDurationSeconds,
                  trafficDelaySeconds: data.trafficDelaySeconds || 0,
                  isTrafficAware: Boolean(data.isTrafficAware),
                  trafficStatus: data.isTrafficAware ? 'LIVE' : 'UNAVAILABLE',
                  routeProvider: data.provider || 'tomtom',
                  calculatedAt: data.calculatedAt || new Date().toISOString(),
                  congestionSegments: data.congestionSegments || [],
                  steps: []
                };
              }
            }
          }
        } catch {
          // fallback to getLiveRoute
        }

        if (!routeInfo) {
          routeInfo = await this.getLiveRoute(origin, dest);
        }

        return { hospital, routeInfo };
      } catch (error) {
        console.warn(`[AERO ROUTING] Failed routing for ${hospital.name}`);
        return { hospital, routeInfo: null };
      }
    });

    const results = await Promise.all(routePromises);
    
    // Sort logic: Primary duration (ETA), Secondary distance
    results.sort((a, b) => {
      // Both routes succeeded
      if (a.routeInfo && b.routeInfo) {
        if (a.routeInfo.etaSeconds !== b.routeInfo.etaSeconds) {
          return a.routeInfo.etaSeconds - b.routeInfo.etaSeconds;
        }
        return a.routeInfo.distanceMeters - b.routeInfo.distanceMeters;
      }
      
      // If one failed, prioritize the one that succeeded
      if (a.routeInfo && !b.routeInfo) return -1;
      if (!a.routeInfo && b.routeInfo) return 1;
      
      // Both failed, fallback to straight line geographic distance
      return a.hospital.distanceMeters - b.hospital.distanceMeters;
    });

    if (results.length > 0) {
      console.log(`[AERO ROUTING] Selected fastest hospital: ${results[0].hospital.name}`);
    }

    // Combine the live-routed top candidates with the rest
    const finalList = [
       ...results.map(res => ({
         ...res.hospital,
         drivingDistanceMeters: res.routeInfo?.distanceMeters || res.hospital.distanceMeters,
         drivingEtaSeconds: res.routeInfo?.etaSeconds,
         routePolyline: res.routeInfo?.polyline,
       })),
       ...remainingCandidates.map(hospital => ({
         ...hospital,
         drivingDistanceMeters: hospital.distanceMeters,
         drivingEtaSeconds: Math.round(hospital.distanceMeters / 15), // fallback ETA
         routePolyline: [],
       }))
    ];

    return finalList;
  },

  /**
   * Calculates the shortest distance in meters from a point to a polyline.
   * Uses high-efficiency equirectangular planar projection with zero trig operations
   * in the inner loop and squared-distance comparisons for optimal time complexity.
   */
  getDistanceToRoute(point: [number, number], polyline: [number, number][]): number {
    if (!polyline || polyline.length < 2) return 0;
    
    const pLat = point[0];
    const pLng = point[1];
    const rad = Math.PI / 180;
    // Flat-earth approximation coefficients centered at current latitude (meters per degree)
    const cosLat = Math.cos(pLat * rad);
    const kx = 111320 * cosLat; // meters per degree lng
    const ky = 110540;          // meters per degree lat

    let minDistSq = Infinity;
    const EARLY_EXIT_SQ = 100; // 10 meters squared (clearly on route)
    const SKIP_BOUND_METERS = 600; // ~600m threshold to quickly bypass distant segments

    // Cache first vertex relative to point in meters
    let x1 = (polyline[0][1] - pLng) * kx;
    let y1 = (polyline[0][0] - pLat) * ky;

    for (let i = 1; i < polyline.length; i++) {
      const x2 = (polyline[i][1] - pLng) * kx;
      const y2 = (polyline[i][0] - pLat) * ky;

      // Fast bounding box rejection in local meters
      const minX = x1 < x2 ? x1 : x2;
      const maxX = x1 > x2 ? x1 : x2;
      const minY = y1 < y2 ? y1 : y2;
      const maxY = y1 > y2 ? y1 : y2;

      if (minX > SKIP_BOUND_METERS || maxX < -SKIP_BOUND_METERS ||
          minY > SKIP_BOUND_METERS || maxY < -SKIP_BOUND_METERS) {
        x1 = x2;
        y1 = y2;
        continue;
      }

      // Vector from p1 to p2
      const dx = x2 - x1;
      const dy = y2 - y1;
      const segLenSq = dx * dx + dy * dy;

      let distSq: number;
      if (segLenSq <= 1e-6) {
        distSq = x1 * x1 + y1 * y1;
      } else {
        // Parameter t of projection of origin (0, 0) onto segment p1->p2
        // Vector from p1 to origin is (-x1, -y1)
        const t = (-x1 * dx - y1 * dy) / segLenSq;
        if (t <= 0) {
          distSq = x1 * x1 + y1 * y1;
        } else if (t >= 1) {
          distSq = x2 * x2 + y2 * y2;
        } else {
          const projX = x1 + t * dx;
          const projY = y1 + t * dy;
          distSq = projX * projX + projY * projY;
        }
      }

      if (distSq < minDistSq) {
        minDistSq = distSq;
        if (minDistSq < EARLY_EXIT_SQ) {
          return Math.sqrt(minDistSq);
        }
      }

      x1 = x2;
      y1 = y2;
    }

    return Math.sqrt(minDistSq);
  }
};

