-- ==============================================================================
-- AERO — Ambulance Arrival & Cross-Dashboard Synchronization Migration
-- 
-- Adds server-generated arrived_at timestamp, arrived_by actor audit,
-- and ensures authoritative incident lifecycle constraints support arrival.
-- ==============================================================================

-- 1. Ensure arrived_at and arrived_by columns exist in emergency_incidents
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'emergency_incidents' 
      AND column_name = 'arrived_at'
  ) THEN
    ALTER TABLE public.emergency_incidents ADD COLUMN arrived_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'emergency_incidents' 
      AND column_name = 'arrived_by'
  ) THEN
    ALTER TABLE public.emergency_incidents ADD COLUMN arrived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Create index on status and arrived_at for fast arrival reconciliation
CREATE INDEX IF NOT EXISTS idx_incidents_arrived_at ON public.emergency_incidents(arrived_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status_lower ON public.emergency_incidents(LOWER(status));

-- 3. Atomic Database Function for Recording Ambulance Arrival
CREATE OR REPLACE FUNCTION public.record_ambulance_arrival(
  p_incident_id UUID,
  p_user_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_incident RECORD;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  -- 1. Lock and retrieve incident
  SELECT * INTO v_incident
  FROM public.emergency_incidents
  WHERE id = p_incident_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Incident not found');
  END IF;

  -- 2. Idempotency: If already arrived, return current arrival data
  IF LOWER(v_incident.status) = 'arrived' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_arrived', true,
      'incident_id', v_incident.id,
      'arrived_at', COALESCE(v_incident.arrived_at, v_incident.updated_at),
      'status', 'arrived'
    );
  END IF;

  -- 3. Validate legal state transition
  IF LOWER(v_incident.status) IN ('resolved', 'completed', 'cancelled') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot mark arrival: Incident is already resolved or cancelled'
    );
  END IF;

  -- 4. Apply arrival updates
  UPDATE public.emergency_incidents
  SET 
    status = 'arrived',
    arrived_at = v_now,
    arrived_by = COALESCE(p_user_id, auth.uid()),
    current_speed = 0,
    route_duration_seconds = 0,
    traffic_duration_seconds = 0,
    corridor_status = 'COMPLETED',
    updated_at = v_now
  WHERE id = p_incident_id;

  RETURN jsonb_build_object(
    'success', true,
    'already_arrived', false,
    'incident_id', p_incident_id,
    'arrived_at', v_now,
    'status', 'arrived'
  );
END;
$$;

-- 4. Realtime publication check
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'emergency_incidents'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.emergency_incidents;
    END IF;
  END IF;
END $$;
