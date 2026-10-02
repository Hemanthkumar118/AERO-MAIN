/**
 * AERO Live Routing & OSRM OpenStreetMap Integration Service
 * Computes live driving corridors, polylines, and ETAs between any GPS coordinates.
 */

import type { RouteInfo, LatLng } from '../types';
import { toLeafletPos, toOsrmCoord, fromOsrmToLeaflet } from '../utils/coordinates';

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
      console.log(`[AERO ROUTING] Routing candidate: ${hospital.name}`);
      try {
        const dest: [number, number] = [hospital.lat, hospital.lng];
        const routeInfo = await this.getLiveRoute(origin, dest);
        
        if (routeInfo && routeInfo.polyline.length > 0) {
          console.log(`[AERO ROUTING] ETA: ${Math.round(routeInfo.etaSeconds/60)} min`);
          console.log(`[AERO ROUTING] Distance: ${(routeInfo.distanceMeters/1000).toFixed(1)} km`);
        } else {
           console.log(`[AERO ROUTING] Fallback ETA used for ${hospital.name}`);
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
   */
  getDistanceToRoute(point: [number, number], polyline: [number, number][]): number {
    if (!polyline || polyline.length < 2) return 0;
    
    // Haversine distance between two points
    const getDist = (p1: [number, number], p2: [number, number]) => {
      const R = 6371e3; // meters
      const lat1 = p1[0] * Math.PI / 180;
      const lat2 = p2[0] * Math.PI / 180;
      const deltaLat = (p2[0] - p1[0]) * Math.PI / 180;
      const deltaLon = (p2[1] - p1[1]) * Math.PI / 180;
      const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
                Math.cos(lat1) * Math.cos(lat2) *
                Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    };

    let minDist = Infinity;
    
    for (let i = 0; i < polyline.length - 1; i++) {
      const p1 = polyline[i];
      const p2 = polyline[i+1];
      
      // Calculate cross-track distance (simplified for small distances)
      const d13 = getDist(p1, point);
      const d12 = getDist(p1, p2);
      const d23 = getDist(p2, point);
      
      // If point is beyond the ends of the segment, use distance to endpoints
      if (d13 * d13 > d12 * d12 + d23 * d23) {
        minDist = Math.min(minDist, d23);
      } else if (d23 * d23 > d12 * d12 + d13 * d13) {
        minDist = Math.min(minDist, d13);
      } else {
        // Cross-track distance
        const s = (d12 + d13 + d23) / 2;
        const area = Math.sqrt(s * (s - d12) * (s - d13) * (s - d23));
        const crossTrack = 2 * area / d12;
        minDist = Math.min(minDist, crossTrack);
      }
    }
    
    return minDist;
  }
};

