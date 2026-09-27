-- ============================================================
-- AERO Emergency Incidents Table — Complete Migration
-- 
-- INSTRUCTIONS:
-- 1. Go to: https://supabase.com/dashboard/project/mfsmlyiwhejmwhpgemns/sql/new
-- 2. Paste this ENTIRE file into the SQL editor
-- 3. Click "Run"
-- 4. You should see: "emergency_incidents table created successfully"
-- ============================================================

-- 1. Create the update_updated_at_column function if not exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create emergency_incidents table
CREATE TABLE IF NOT EXISTS public.emergency_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  incident_type TEXT NOT NULL,
  priority TEXT CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'dispatched', 'en_route', 'arrived', 'resolved', 'cancelled')),
  ambulance_id TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  destination_hospital TEXT,
  destination_latitude DOUBLE PRECISION,
  destination_longitude DOUBLE PRECISION,
  eta_minutes INTEGER,
  destination_address TEXT,
  route_geometry JSONB,
  route_distance_meters DOUBLE PRECISION,
  route_duration_seconds DOUBLE PRECISION,
  current_latitude DOUBLE PRECISION,
  current_longitude DOUBLE PRECISION,
  current_accuracy DOUBLE PRECISION,
  current_speed DOUBLE PRECISION,
  current_heading DOUBLE PRECISION,
  corridor_status TEXT DEFAULT 'PENDING' CHECK (corridor_status IN ('PENDING', 'CLEARING', 'CLEAR', 'CAUTION', 'BLOCKED')),
  police_acknowledged_at TIMESTAMP WITH TIME ZONE,
  police_id UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMP WITH TIME ZONE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Enable RLS
ALTER TABLE public.emergency_incidents ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their incidents' AND tablename = 'emergency_incidents') THEN
    -- For AERO, police and hospitals also need to view incidents. 
    -- The most robust way without complex role checks here is to allow all authenticated users to read incidents, 
    -- which is standard for collaborative dashboards like AERO unless restricted by role.
    CREATE POLICY "Users can view their incidents" ON public.emergency_incidents FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert incidents' AND tablename = 'emergency_incidents') THEN
    CREATE POLICY "Users can insert incidents" ON public.emergency_incidents FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update their incidents' AND tablename = 'emergency_incidents') THEN
    -- Both ambulance (creator) and police/hospital need to update incidents (e.g. acknowledge, clear corridor).
    CREATE POLICY "Users can update their incidents" ON public.emergency_incidents FOR UPDATE TO authenticated USING (true);
  END IF;
END $$;

-- 5. Updated_at trigger
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_emergency_incidents_modtime') THEN
    CREATE TRIGGER update_emergency_incidents_modtime
    BEFORE UPDATE ON public.emergency_incidents
    FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();
  END IF;
END $$;

-- 6. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_incidents_user_id ON public.emergency_incidents(user_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.emergency_incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_police_id ON public.emergency_incidents(police_id);
CREATE INDEX IF NOT EXISTS idx_incidents_updated_at ON public.emergency_incidents(updated_at);

-- 7. Enable Realtime for emergency_incidents
-- Check if the table is already in the publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'emergency_incidents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.emergency_incidents;
  END IF;
END $$;

-- 8. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- 9. Verify
SELECT 'emergency_incidents table created successfully' AS status;
