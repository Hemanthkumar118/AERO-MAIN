-- Add missing columns for traffic, routing providers, and versioning

ALTER TABLE public.emergency_incidents 
  ADD COLUMN IF NOT EXISTS traffic_duration_seconds DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS traffic_status TEXT DEFAULT 'UNAVAILABLE',
  ADD COLUMN IF NOT EXISTS route_provider TEXT DEFAULT 'osrm',
  ADD COLUMN IF NOT EXISTS route_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_reroute_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS distance_remaining_meters DOUBLE PRECISION;

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
