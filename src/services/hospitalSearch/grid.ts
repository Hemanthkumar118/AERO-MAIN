/**
 * Utility for generating a geographic grid of search coordinates to 
 * comprehensively cover a large radius by performing multiple localized searches.
 */

// Earth's radius in meters
const EARTH_RADIUS_M = 6371000;

export interface GridPoint {
  lat: number;
  lng: number;
}

/**
 * Calculates a new coordinate given a starting coordinate, bearing, and distance.
 */
function getDestinationPoint(lat: number, lng: number, bearingDeg: number, distanceM: number): GridPoint {
  const lat1 = lat * Math.PI / 180;
  const lng1 = lng * Math.PI / 180;
  const brng = bearingDeg * Math.PI / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceM / EARTH_RADIUS_M) +
    Math.cos(lat1) * Math.sin(distanceM / EARTH_RADIUS_M) * Math.cos(brng)
  );

  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(distanceM / EARTH_RADIUS_M) * Math.cos(lat1),
    Math.cos(distanceM / EARTH_RADIUS_M) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: lat2 * 180 / Math.PI,
    lng: lng2 * 180 / Math.PI
  };
}

/**
 * Generates an array of grid coordinates to cover the given radius.
 * The distance between points is designed so that a localized search of `stepRadiusMeters`
 * at each point will overlap and cover the entire `totalRadiusMeters`.
 */
export function generateSearchGrid(centerLat: number, centerLng: number, totalRadiusMeters: number, stepRadiusMeters: number): GridPoint[] {
  const points: GridPoint[] = [{ lat: centerLat, lng: centerLng }];
  
  if (totalRadiusMeters <= stepRadiusMeters) {
    return points;
  }

  // Calculate how many "rings" of search points we need
  const numRings = Math.ceil(totalRadiusMeters / (stepRadiusMeters * 1.5));
  
  for (let ring = 1; ring <= numRings; ring++) {
    const ringDistance = ring * stepRadiusMeters * 1.5;
    if (ringDistance > totalRadiusMeters + stepRadiusMeters) {
      break;
    }
    
    // Number of points in this ring to ensure coverage
    const numPointsInRing = Math.max(6, Math.ceil((2 * Math.PI * ringDistance) / (stepRadiusMeters * 1.5)));
    
    for (let i = 0; i < numPointsInRing; i++) {
      const bearing = (360 / numPointsInRing) * i;
      points.push(getDestinationPoint(centerLat, centerLng, bearing, ringDistance));
    }
  }

  return points;
}
