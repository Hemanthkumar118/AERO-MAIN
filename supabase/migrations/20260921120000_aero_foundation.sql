-- ============================================================
-- AERO Database Foundation (PostGIS, Core Entities, RLS)
-- ============================================================

-- 0. Enable PostGIS Extension
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

-- ============================================================
-- 1. HOSPITALS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hospitals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  address TEXT,
  location geometry(Point, 4326),
  phone TEXT,
  emergency_capable BOOLEAN DEFAULT true,
  total_beds INTEGER,
  available_icu_beds INTEGER,
  trauma_bays_available INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================
-- 2. AMBULANCES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ambulances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_number TEXT UNIQUE NOT NULL,
  hospital_id UUID REFERENCES public.hospitals(id),
  driver_id UUID REFERENCES auth.users(id),
  equipment_level TEXT CHECK (equipment_level IN ('BLS', 'ALS', 'ICU')),
  current_status TEXT DEFAULT 'AVAILABLE' CHECK (current_status IN ('AVAILABLE', 'UNAVAILABLE', 'BUSY', 'EN_ROUTE')),
  location geometry(Point, 4326),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================
-- 3. JUNCTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.junctions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  location geometry(Point, 4326) NOT NULL,
  status TEXT DEFAULT 'NORMAL' CHECK (status IN ('NORMAL', 'PREPARING', 'CLEARED', 'PASSED')),
  assigned_police_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================
-- 4. TRAFFIC INCIDENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.traffic_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT CHECK (type IN ('ACCIDENT', 'ROAD_BLOCKAGE', 'CONGESTION', 'CONSTRUCTION', 'WATERLOGGING')),
  severity TEXT CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  title TEXT NOT NULL,
  description TEXT,
  location geometry(Point, 4326) NOT NULL,
  reported_by UUID REFERENCES auth.users(id),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================
-- 5. LOCATION TELEMETRY
-- ============================================================
CREATE TABLE IF NOT EXISTS public.location_telemetry (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id UUID NOT NULL, -- ambulance_id or police_id
  entity_type TEXT CHECK (entity_type IN ('AMBULANCE', 'POLICE')),
  location geometry(Point, 4326) NOT NULL,
  accuracy DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================
-- 6. ROUTES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.routes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  emergency_id UUID REFERENCES public.emergency_incidents(id) ON DELETE CASCADE,
  polyline geometry(LineString, 4326),
  distance_meters DOUBLE PRECISION,
  eta_seconds INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================
-- 7. NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================
-- 8. POLICE ASSIGNMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.police_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  police_id UUID REFERENCES auth.users(id) NOT NULL,
  junction_id UUID REFERENCES public.junctions(id),
  emergency_id UUID REFERENCES public.emergency_incidents(id),
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================
-- 9. EMERGENCY STATUS LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.emergency_status_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  emergency_id UUID REFERENCES public.emergency_incidents(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================
-- EXTEND PROFILES
-- ============================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS badge_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS station_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS hospital_id UUID REFERENCES public.hospitals(id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambulances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.junctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traffic_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.police_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_status_logs ENABLE ROW LEVEL SECURITY;

-- Hospitals: Anyone can read, only hospital operators can update
CREATE POLICY "Public can view hospitals" ON public.hospitals FOR SELECT USING (true);
CREATE POLICY "Hospital operators can update" ON public.hospitals FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('hospital_operator', 'admin'))
);

-- Ambulances: Public can view, ambulance operators can update
CREATE POLICY "Public can view ambulances" ON public.ambulances FOR SELECT USING (true);
CREATE POLICY "Ambulance operators update own" ON public.ambulances FOR UPDATE USING (driver_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- Junctions: Public view, Traffic police update
CREATE POLICY "Public can view junctions" ON public.junctions FOR SELECT USING (true);
CREATE POLICY "Traffic Police can update junctions" ON public.junctions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('traffic_operator', 'admin'))
);

-- Traffic Incidents: Public view, Anyone authenticated can insert
CREATE POLICY "Public can view traffic incidents" ON public.traffic_incidents FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert incidents" ON public.traffic_incidents FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Location Telemetry: Public read, Entities can insert their own
CREATE POLICY "Public can view location telemetry" ON public.location_telemetry FOR SELECT USING (true);
CREATE POLICY "Entities can insert telemetry" ON public.location_telemetry FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Routes: Public read, Ambulance insert/update
CREATE POLICY "Public can view routes" ON public.routes FOR SELECT USING (true);
CREATE POLICY "Ambulance can insert routes" ON public.routes FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Ambulance can update routes" ON public.routes FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Notifications: Only the user can view/update their notifications
CREATE POLICY "Users view own notifications" ON public.notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE USING (user_id = auth.uid());

-- Police Assignments: Traffic police can view and update
CREATE POLICY "Traffic Police can view assignments" ON public.police_assignments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('traffic_operator', 'admin'))
);
CREATE POLICY "Traffic Police can insert assignments" ON public.police_assignments FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('traffic_operator', 'admin'))
);

-- Emergency Status Logs: Public read, authenticated users can insert
CREATE POLICY "Public can view emergency status logs" ON public.emergency_status_logs FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert emergency status logs" ON public.emergency_status_logs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_hospitals_modtime') THEN CREATE TRIGGER update_hospitals_modtime BEFORE UPDATE ON public.hospitals FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ambulances_modtime') THEN CREATE TRIGGER update_ambulances_modtime BEFORE UPDATE ON public.ambulances FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_junctions_modtime') THEN CREATE TRIGGER update_junctions_modtime BEFORE UPDATE ON public.junctions FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_traffic_incidents_modtime') THEN CREATE TRIGGER update_traffic_incidents_modtime BEFORE UPDATE ON public.traffic_incidents FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column(); END IF; END $$;

-- ============================================================
-- REALTIME PUBLICATIONS
-- ============================================================
DO $$
BEGIN
  -- We assume 'supabase_realtime' publication already exists from full_setup.sql
  -- Attempt to add tables to it.
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ambulances;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.junctions;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.traffic_incidents;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.location_telemetry;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.police_assignments;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Error adding tables to supabase_realtime.';
END;
$$;
