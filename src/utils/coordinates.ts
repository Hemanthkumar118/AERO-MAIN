/**
 * Centralized coordinate utility for strict handling of geographic coordinates
 * between Leaflet/Map rendering (Lat, Lng) and GeoJSON/OSRM routing (Lng, Lat).
 */

import type { LatLng } from '../types';

/**
 * Returns a tuple representing Leaflet coordinates: [Latitude, Longitude]
 */
export function toLeafletPos(coord: LatLng | [number, number]): [number, number] {
  if (Array.isArray(coord)) {
    // Assuming Leaflet coordinates [lat, lng]
    return [coord[0], coord[1]];
  }
  return [coord.latitude, coord.longitude];
}

/**
 * Returns a tuple representing OSRM/GeoJSON coordinates: [Longitude, Latitude]
 */
export function toOsrmCoord(coord: LatLng | [number, number]): [number, number] {
  if (Array.isArray(coord)) {
    // Assuming Leaflet coordinates [lat, lng] are passed in
    return [coord[1], coord[0]];
  }
  return [coord.longitude, coord.latitude];
}

/**
 * Explicitly convert an OSRM array [lng, lat] to Leaflet array [lat, lng]
 */
export function fromOsrmToLeaflet(osrmCoord: [number, number]): [number, number] {
  return [osrmCoord[1], osrmCoord[0]];
}
