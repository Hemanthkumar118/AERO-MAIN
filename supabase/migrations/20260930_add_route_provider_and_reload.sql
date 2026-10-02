-- Add route_provider to emergency_incidents if it does not exist
ALTER TABLE public.emergency_incidents
ADD COLUMN IF NOT EXISTS route_provider TEXT;

-- Notify PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';
