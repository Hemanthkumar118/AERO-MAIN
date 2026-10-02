-- Safe additive migration to ensure route fields exist in emergency_incidents
-- and to force PostgREST to reload its schema cache to fix "Could not find column" errors.

ALTER TABLE public.emergency_incidents 
  ADD COLUMN IF NOT EXISTS traffic_duration_seconds DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS traffic_status TEXT DEFAULT 'UNAVAILABLE',
  ADD COLUMN IF NOT EXISTS route_provider TEXT DEFAULT 'osrm',
  ADD COLUMN IF NOT EXISTS route_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_reroute_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS distance_remaining_meters DOUBLE PRECISION;

-- Forcefully refresh the PostgREST schema cache
NOTIFY pgrst, 'reload schema';
