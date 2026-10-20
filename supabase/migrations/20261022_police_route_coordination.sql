-- ============================================================
-- AERO Route-Based Ambulance & Police Coordination Engine Migration
-- ============================================================

-- Enable PostGIS if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

-- 1. Coordination Plans Table (Scoped by Incident & Route Version)
CREATE TABLE IF NOT EXISTS public.police_coordination_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES public.emergency_incidents(id) ON DELETE CASCADE,
  route_version INTEGER NOT NULL DEFAULT 1,
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REPLANNING', 'SUPERSEDED', 'COMPLETED', 'CANCELLED')),
  total_junctions INTEGER DEFAULT 0,
  cleared_junctions INTEGER DEFAULT 0,
  coverage_gap_count INTEGER DEFAULT 0,
  route_distance_meters DOUBLE PRECISION,
  route_duration_seconds DOUBLE PRECISION,
  corridor_distance_meters DOUBLE PRECISION DEFAULT 350.0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(incident_id, route_version)
);

-- 2. Police Route Assignments Table (Junction-by-junction sequential route order)
CREATE TABLE IF NOT EXISTS public.police_route_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES public.police_coordination_plans(id) ON DELETE CASCADE,
  incident_id UUID REFERENCES public.emergency_incidents(id) ON DELETE CASCADE,
  police_id UUID REFERENCES auth.users(id),
  police_name TEXT,
  badge_number TEXT,
  station_name TEXT,
  junction_id UUID REFERENCES public.junctions(id),
  junction_name TEXT NOT NULL,
  junction_latitude DOUBLE PRECISION NOT NULL,
  junction_longitude DOUBLE PRECISION NOT NULL,
  junction_geom geometry(Point, 4326),
  sequence_order INTEGER NOT NULL, -- 1 for P1, 2 for P2, etc.
  route_station_meters DOUBLE PRECISION NOT NULL, -- cumulative meters along route from start
  perpendicular_distance_meters DOUBLE PRECISION DEFAULT 0.0,
  distance_from_ambulance_meters DOUBLE PRECISION DEFAULT 0.0,
  estimated_ambulance_arrival TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'PROPOSED' CHECK (status IN (
    'PROPOSED',
    'NOTIFIED',
    'ACKNOWLEDGED',
    'EN_ROUTE_TO_POSITION',
    'READY',
    'CLEARANCE_CONFIRMED',
    'PASSED',
    'COMPLETED',
    'REJECTED',
    'UNAVAILABLE',
    'NO_RESPONSE',
    'BLOCKED',
    'CLEARANCE_REVOKED',
    'CANCELLED',
    'REASSIGNED'
  )),
  is_reinforcement BOOLEAN DEFAULT FALSE,
  traffic_condition TEXT DEFAULT 'NORMAL' CHECK (traffic_condition IN ('NORMAL', 'MODERATE', 'CONGESTED', 'GRIDLOCK', 'BLOCKED')),
  notification_sent_at TIMESTAMP WITH TIME ZONE,
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  ready_at TIMESTAMP WITH TIME ZONE,
  cleared_at TIMESTAMP WITH TIME ZONE,
  passed_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  blockage_details TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Police Assignment Audit Logs Table (Immutable lifecycle transition trail)
CREATE TABLE IF NOT EXISTS public.police_assignment_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID REFERENCES public.police_route_assignments(id) ON DELETE CASCADE,
  incident_id UUID REFERENCES public.emergency_incidents(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  changed_by_name TEXT,
  actor_role TEXT, -- 'police', 'ambulance', 'admin', 'system'
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Police Officer Dynamic State & Patrol Zones
CREATE TABLE IF NOT EXISTS public.police_officer_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  police_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  officer_name TEXT NOT NULL,
  badge_number TEXT,
  station_name TEXT,
  availability TEXT DEFAULT 'AVAILABLE' CHECK (availability IN ('AVAILABLE', 'ASSIGNED', 'BUSY', 'OFF_DUTY')),
  current_latitude DOUBLE PRECISION,
  current_longitude DOUBLE PRECISION,
  current_geom geometry(Point, 4326),
  assigned_zone TEXT,
  primary_junction_id UUID REFERENCES public.junctions(id),
  active_incident_count INTEGER DEFAULT 0,
  last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Indexes for Performance & PostGIS Spatial Searches
CREATE INDEX IF NOT EXISTS idx_police_plans_incident ON public.police_coordination_plans(incident_id, status);
CREATE INDEX IF NOT EXISTS idx_police_assignments_incident_seq ON public.police_route_assignments(incident_id, sequence_order);
CREATE INDEX IF NOT EXISTS idx_police_assignments_police ON public.police_route_assignments(police_id, status);
CREATE INDEX IF NOT EXISTS idx_police_assignments_plan ON public.police_route_assignments(plan_id);
CREATE INDEX IF NOT EXISTS idx_police_audit_assignment ON public.police_assignment_audit_logs(assignment_id);
CREATE INDEX IF NOT EXISTS idx_police_officer_geom ON public.police_officer_states USING GIST(current_geom);
CREATE INDEX IF NOT EXISTS idx_police_assignments_geom ON public.police_route_assignments USING GIST(junction_geom);

-- 6. Row Level Security Policies
ALTER TABLE public.police_coordination_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.police_route_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.police_assignment_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.police_officer_states ENABLE ROW LEVEL SECURITY;

-- Plans RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can view coordination plans' AND tablename = 'police_coordination_plans') THEN
    CREATE POLICY "Authenticated users can view coordination plans" ON public.police_coordination_plans
      FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins and Traffic Police can manage coordination plans' AND tablename = 'police_coordination_plans') THEN
    CREATE POLICY "Admins and Traffic Police can manage coordination plans" ON public.police_coordination_plans
      FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('traffic_operator', 'admin', 'ambulance'))
      );
  END IF;
END $$;

-- Route Assignments RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Officers view assigned or relevant assignments' AND tablename = 'police_route_assignments') THEN
    CREATE POLICY "Officers view assigned or relevant assignments" ON public.police_route_assignments
      FOR SELECT USING (
        police_id = auth.uid() OR 
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('traffic_operator', 'admin', 'ambulance'))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Officers update own assignments' AND tablename = 'police_route_assignments') THEN
    CREATE POLICY "Officers update own assignments" ON public.police_route_assignments
      FOR UPDATE USING (
        police_id = auth.uid() OR 
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('traffic_operator', 'admin'))
      );
  END IF;
END $$;

-- Audit Logs RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated view audit logs' AND tablename = 'police_assignment_audit_logs') THEN
    CREATE POLICY "Authenticated view audit logs" ON public.police_assignment_audit_logs
      FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated insert audit logs' AND tablename = 'police_assignment_audit_logs') THEN
    CREATE POLICY "Authenticated insert audit logs" ON public.police_assignment_audit_logs
      FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- Officer States RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public view officer states' AND tablename = 'police_officer_states') THEN
    CREATE POLICY "Public view officer states" ON public.police_officer_states
      FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Officers update own state' AND tablename = 'police_officer_states') THEN
    CREATE POLICY "Officers update own state" ON public.police_officer_states
      FOR ALL USING (
        police_id = auth.uid() OR 
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
      );
  END IF;
END $$;

-- 7. Realtime Publication
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.police_coordination_plans;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.police_route_assignments;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.police_officer_states;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Error adding police coordination tables to supabase_realtime publication.';
END $$;
