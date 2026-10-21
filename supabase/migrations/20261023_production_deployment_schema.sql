-- ==============================================================================
-- AERO (Ambulance Emergency Routing Operation)
-- Consolidated Production Deployment Migration
-- File: supabase/migrations/20261023_production_deployment_schema.sql
--
-- INSTRUCTIONS TO RUN:
-- 1. Open Supabase Dashboard: https://supabase.com/dashboard/project/mfsmlyiwhejmwhpgemns/sql/new
-- 2. Paste this entire SQL file and click "Run".
-- 3. In Dashboard under Authentication -> URL Configuration -> Redirect URLs:
--    Add:
--      http://localhost:5173/**
--      http://192.168.1.39:5173/**
--      https://your-production-domain.com/**
-- ==============================================================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Reusable timestamp trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 2. Hospitals Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hospitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  phone TEXT,
  total_er_beds INTEGER DEFAULT 20,
  available_er_beds INTEGER DEFAULT 15,
  total_icu_beds INTEGER DEFAULT 8,
  available_icu_beds INTEGER DEFAULT 4,
  trauma_capability BOOLEAN DEFAULT true,
  cardiac_capability BOOLEAN DEFAULT true,
  burn_capability BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'NORMAL' CHECK (status IN ('NORMAL', 'BUSY', 'OVERLOADED', 'DIVERTING', 'CRITICAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_hospitals_location ON public.hospitals(latitude, longitude);

-- ------------------------------------------------------------------------------
-- 3. Profiles Table (Linked to auth.users)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'ambulance' CHECK (role IN ('ambulance', 'police', 'hospital', 'admin', 'traffic_operator', 'hospital_operator', 'ambulance_operator')),
  full_name TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PENDING', 'SUSPENDED', 'BLOCKED')),
  badge_number TEXT,
  vehicle_number TEXT,
  hospital_id UUID REFERENCES public.hospitals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ensure missing columns exist if table was already created
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='badge_number') THEN
    ALTER TABLE public.profiles ADD COLUMN badge_number TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='vehicle_number') THEN
    ALTER TABLE public.profiles ADD COLUMN vehicle_number TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='hospital_id') THEN
    ALTER TABLE public.profiles ADD COLUMN hospital_id UUID REFERENCES public.hospitals(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='status') THEN
    ALTER TABLE public.profiles ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';
  END IF;
END $$;

-- Automatic profile creation on auth.users signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
  v_full_name TEXT;
  v_badge TEXT;
  v_vehicle TEXT;
  v_hospital_id UUID;
BEGIN
  v_role := LOWER(COALESCE(NEW.raw_user_meta_data->>'role', 'ambulance'));
  
  IF v_role NOT IN ('ambulance', 'police', 'hospital', 'admin', 'traffic_operator', 'hospital_operator', 'ambulance_operator') THEN
    IF v_role LIKE '%police%' OR v_role LIKE '%traffic%' THEN
      v_role := 'police';
    ELSIF v_role LIKE '%hosp%' THEN
      v_role := 'hospital';
    ELSIF v_role LIKE '%admin%' THEN
      v_role := 'admin';
    ELSE
      v_role := 'ambulance';
    END IF;
  END IF;

  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  v_badge := NEW.raw_user_meta_data->>'badge_number';
  v_vehicle := NEW.raw_user_meta_data->>'vehicle_number';
  
  BEGIN
    v_hospital_id := (NEW.raw_user_meta_data->>'hospital_id')::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_hospital_id := NULL;
  END;

  INSERT INTO public.profiles (
    id, full_name, role, status, badge_number, vehicle_number, hospital_id, created_at, updated_at
  )
  VALUES (
    NEW.id,
    v_full_name,
    v_role,
    'ACTIVE',
    v_badge,
    v_vehicle,
    v_hospital_id,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      role = COALESCE(profiles.role, EXCLUDED.role),
      badge_number = COALESCE(profiles.badge_number, EXCLUDED.badge_number),
      vehicle_number = COALESCE(profiles.vehicle_number, EXCLUDED.vehicle_number),
      hospital_id = COALESCE(profiles.hospital_id, EXCLUDED.hospital_id),
      updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill missing profiles
INSERT INTO public.profiles (id, full_name, role, status, created_at, updated_at)
SELECT 
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  LOWER(COALESCE(u.raw_user_meta_data->>'role', 'ambulance')),
  'ACTIVE',
  NOW(),
  NOW()
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 4. Emergency Incidents Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.emergency_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambulance_id TEXT,
  assigned_paramedic_id UUID REFERENCES auth.users(id),
  hospital_id UUID REFERENCES public.hospitals(id) ON DELETE SET NULL,
  hospital_name TEXT,
  status TEXT NOT NULL DEFAULT 'DISPATCHED' CHECK (status IN ('DISPATCHED', 'EN_ROUTE', 'ARRIVED_SCENE', 'PATIENT_LOADED', 'TRANSPORTING', 'ARRIVED_HOSPITAL', 'RESOLVED', 'CANCELLED')),
  severity TEXT DEFAULT 'HIGH' CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  triage_severity TEXT DEFAULT 'HIGH' CHECK (triage_severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  chief_complaint TEXT,
  emergency_category TEXT DEFAULT 'TRAUMA',
  
  -- Route Geometries & Telemetry
  origin_lat DOUBLE PRECISION,
  origin_lng DOUBLE PRECISION,
  dest_lat DOUBLE PRECISION,
  dest_lng DOUBLE PRECISION,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  eta_seconds INTEGER DEFAULT 600,
  distance_meters DOUBLE PRECISION DEFAULT 5000,
  route_coordinates JSONB,
  route_provider TEXT DEFAULT 'tomtom',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.emergency_incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_hospital_id ON public.emergency_incidents(hospital_id);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON public.emergency_incidents(created_at DESC);

-- Ensure missing columns exist
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='emergency_incidents' AND column_name='route_provider') THEN
    ALTER TABLE public.emergency_incidents ADD COLUMN route_provider TEXT DEFAULT 'tomtom';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='emergency_incidents' AND column_name='route_coordinates') THEN
    ALTER TABLE public.emergency_incidents ADD COLUMN route_coordinates JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='emergency_incidents' AND column_name='chief_complaint') THEN
    ALTER TABLE public.emergency_incidents ADD COLUMN chief_complaint TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='emergency_incidents' AND column_name='triage_severity') THEN
    ALTER TABLE public.emergency_incidents ADD COLUMN triage_severity TEXT DEFAULT 'HIGH';
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. Clinical Observations Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clinical_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES public.emergency_incidents(id) ON DELETE CASCADE,
  recorded_by UUID REFERENCES auth.users(id),
  recorded_by_name TEXT,
  recorded_by_role TEXT NOT NULL DEFAULT 'ambulance',
  ambulance_id TEXT,
  hospital_id TEXT,
  hospital_name TEXT,
  
  -- Vitals
  heart_rate INTEGER CHECK (heart_rate IS NULL OR (heart_rate >= 20 AND heart_rate <= 300)),
  systolic_bp INTEGER CHECK (systolic_bp IS NULL OR (systolic_bp >= 40 AND systolic_bp <= 300)),
  diastolic_bp INTEGER CHECK (diastolic_bp IS NULL OR (diastolic_bp >= 20 AND diastolic_bp <= 200)),
  spo2 INTEGER CHECK (spo2 IS NULL OR (spo2 >= 50 AND spo2 <= 100)),
  respiratory_rate INTEGER CHECK (respiratory_rate IS NULL OR (respiratory_rate >= 4 AND respiratory_rate <= 80)),
  gcs INTEGER CHECK (gcs IS NULL OR (gcs >= 3 AND gcs <= 15)),
  temperature DOUBLE PRECISION CHECK (temperature IS NULL OR (temperature >= 30.0 AND temperature <= 45.0)),
  
  emergency_category TEXT NOT NULL CHECK (emergency_category IN ('TRAUMA', 'CARDIAC', 'RESPIRATORY', 'STROKE', 'SEPSIS', 'PEDIATRIC', 'BURNS', 'GENERAL_MEDICAL', 'OTHER')),
  triage_severity TEXT NOT NULL DEFAULT 'CRITICAL' CHECK (triage_severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  chief_complaint TEXT,
  clinical_notes TEXT,
  is_manual BOOLEAN NOT NULL DEFAULT true,
  source_device TEXT DEFAULT 'MANUAL_PARAMEDIC_ENTRY',
  
  recorded_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clinical_observations_incident_id ON public.clinical_observations(incident_id);
CREATE INDEX IF NOT EXISTS idx_clinical_observations_recorded_at ON public.clinical_observations(recorded_at DESC);

-- ------------------------------------------------------------------------------
-- 6. Police Route Coordination Plans & Assignments
-- ------------------------------------------------------------------------------
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
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(incident_id, route_version)
);

CREATE TABLE IF NOT EXISTS public.police_route_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES public.police_coordination_plans(id) ON DELETE CASCADE,
  incident_id UUID REFERENCES public.emergency_incidents(id) ON DELETE CASCADE,
  police_id UUID REFERENCES auth.users(id),
  police_name TEXT,
  badge_number TEXT,
  station_name TEXT,
  junction_name TEXT NOT NULL,
  junction_latitude DOUBLE PRECISION NOT NULL,
  junction_longitude DOUBLE PRECISION NOT NULL,
  sequence_order INTEGER NOT NULL,
  route_station_meters DOUBLE PRECISION NOT NULL,
  distance_from_ambulance_meters DOUBLE PRECISION DEFAULT 0.0,
  estimated_ambulance_arrival TIMESTAMPTZ,
  status TEXT DEFAULT 'PROPOSED' CHECK (status IN (
    'PROPOSED', 'NOTIFIED', 'ACKNOWLEDGED', 'EN_ROUTE_TO_POSITION',
    'READY', 'CLEARANCE_CONFIRMED', 'PASSED', 'COMPLETED',
    'REJECTED', 'UNAVAILABLE', 'NO_RESPONSE', 'BLOCKED',
    'CLEARANCE_REVOKED', 'CANCELLED', 'REASSIGNED'
  )),
  is_reinforcement BOOLEAN DEFAULT FALSE,
  traffic_condition TEXT DEFAULT 'NORMAL' CHECK (traffic_condition IN ('NORMAL', 'MODERATE', 'CONGESTED', 'GRIDLOCK', 'BLOCKED')),
  cleared_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_police_assignments_incident_id ON public.police_route_assignments(incident_id);
CREATE INDEX IF NOT EXISTS idx_police_assignments_police_id ON public.police_route_assignments(police_id);
CREATE INDEX IF NOT EXISTS idx_police_assignments_status ON public.police_route_assignments(status);

-- ------------------------------------------------------------------------------
-- 7. AI Conversations & Messages Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Emergency Chat',
  incident_id UUID REFERENCES public.emergency_incidents(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived', 'closed')),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.ai_conversations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON public.ai_messages(conversation_id, created_at ASC);

-- ------------------------------------------------------------------------------
-- 8. Row Level Security (RLS) Configuration
-- ------------------------------------------------------------------------------
ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.police_coordination_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.police_route_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

-- Hospitals: Read-only for authenticated & anon (needed for registration & selection)
DROP POLICY IF EXISTS "Anyone can view hospitals" ON public.hospitals;
CREATE POLICY "Anyone can view hospitals" ON public.hospitals FOR SELECT TO authenticated, anon USING (true);

-- Profiles: Users view own or admins/police coordinators view active units
DROP POLICY IF EXISTS "Users can view profiles" ON public.profiles;
CREATE POLICY "Users can view profiles" ON public.profiles FOR SELECT TO authenticated
USING (
  auth.uid() = id OR
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'traffic_operator', 'police')
  )
);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Emergency Incidents: Network collaborative read/write for authenticated emergency crews
DROP POLICY IF EXISTS "Authenticated users view incidents" ON public.emergency_incidents;
CREATE POLICY "Authenticated users view incidents" ON public.emergency_incidents FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users insert incidents" ON public.emergency_incidents;
CREATE POLICY "Authenticated users insert incidents" ON public.emergency_incidents FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users update incidents" ON public.emergency_incidents;
CREATE POLICY "Authenticated users update incidents" ON public.emergency_incidents FOR UPDATE TO authenticated USING (true);

-- Clinical Observations: Authenticated medical & emergency responders
DROP POLICY IF EXISTS "Responders view clinical observations" ON public.clinical_observations;
CREATE POLICY "Responders view clinical observations" ON public.clinical_observations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Responders insert clinical observations" ON public.clinical_observations;
CREATE POLICY "Responders insert clinical observations" ON public.clinical_observations FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Responders update clinical observations" ON public.clinical_observations;
CREATE POLICY "Responders update clinical observations" ON public.clinical_observations FOR UPDATE TO authenticated USING (true);

-- Police Coordination: Responders & dispatchers
DROP POLICY IF EXISTS "Responders view coordination plans" ON public.police_coordination_plans;
CREATE POLICY "Responders view coordination plans" ON public.police_coordination_plans FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Responders manage coordination plans" ON public.police_coordination_plans;
CREATE POLICY "Responders manage coordination plans" ON public.police_coordination_plans FOR ALL TO authenticated USING (true);

DROP POLICY IF EXISTS "Responders view route assignments" ON public.police_route_assignments;
CREATE POLICY "Responders view route assignments" ON public.police_route_assignments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Responders manage route assignments" ON public.police_route_assignments;
CREATE POLICY "Responders manage route assignments" ON public.police_route_assignments FOR ALL TO authenticated USING (true);

-- AI Conversations & Messages: Strictly scoped to owning user
DROP POLICY IF EXISTS "Users can view own conversations" ON public.ai_conversations;
CREATE POLICY "Users can view own conversations" ON public.ai_conversations FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own conversations" ON public.ai_conversations;
CREATE POLICY "Users can insert own conversations" ON public.ai_conversations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own messages" ON public.ai_messages;
CREATE POLICY "Users can view own messages" ON public.ai_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own messages" ON public.ai_messages;
CREATE POLICY "Users can insert own messages" ON public.ai_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 9. Realtime Publication Setup
-- ------------------------------------------------------------------------------
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.emergency_incidents;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.clinical_observations;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.police_route_assignments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.hospitals;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------------------------
-- 10. Refresh PostgREST Schema Cache
-- ------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
