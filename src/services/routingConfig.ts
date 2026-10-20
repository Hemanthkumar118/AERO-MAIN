export const ROUTING_CONFIG = {
  PRIMARY_PROVIDER: (import.meta.env.VITE_ROUTING_PROVIDER || 'tomtom') as 'tomtom' | 'ors' | 'osrm',
  FALLBACK_PROVIDER: 'osrm',
  REROUTE_DISTANCE_THRESHOLD: 100, // meters
  OFF_ROUTE_THRESHOLD: 75, // meters
  ROUTE_REFRESH_INTERVAL: 45000, // ms
  REROUTE_COOLDOWN: 10000, // ms
  ROUTE_CACHE_TTL: 45000 // ms
};
