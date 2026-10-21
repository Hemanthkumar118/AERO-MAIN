-- ============================================================
-- AERO — Complete Supabase Auth, Profiles & RLS Repair Migration
-- File: supabase/migrations/20261022_auth_profiles_and_rls_repair.sql
-- 
-- INSTRUCTIONS TO RUN:
-- 1. Open Supabase Dashboard: https://supabase.com/dashboard/project/mfsmlyiwhejmwhpgemns/sql/new
-- 2. Paste this entire SQL file and click "Run".
-- 3. In Dashboard under Authentication -> URL Configuration -> Redirect URLs:
--    Add:
--      http://localhost:5173/**
--      http://192.168.1.39:5173/**
-- ============================================================

-- 1. Ensure required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Ensure public.profiles table exists with all required columns
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

-- Ensure missing columns exist if table was already created previously
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

-- 3. Confirm all existing unconfirmed accounts so they can sign in immediately
UPDATE auth.users
SET email_confirmed_at = NOW()
WHERE email_confirmed_at IS NULL;

-- 4. Automatic profile generation trigger for new signups
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
  
  -- Normalize role to standard accepted roles
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

-- 5. Backfill profiles for all existing users who do not have a profile record yet
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

-- 6. Enable and configure RLS on public.profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = id OR
    EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'traffic_operator')
    )
  );

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 7. Ensure collaborative RLS on emergency_incidents
ALTER TABLE public.emergency_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read incidents" ON public.emergency_incidents;
CREATE POLICY "Allow authenticated read incidents"
  ON public.emergency_incidents FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert incidents" ON public.emergency_incidents;
CREATE POLICY "Allow authenticated insert incidents"
  ON public.emergency_incidents FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated update incidents" ON public.emergency_incidents;
CREATE POLICY "Allow authenticated update incidents"
  ON public.emergency_incidents FOR UPDATE TO authenticated
  USING (true);

-- 8. Enable Realtime Replication on required tables
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.emergency_incidents;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- 9. Refresh schema cache
NOTIFY pgrst, 'reload schema';

-- 10. Verification: Output all users with confirmation and profile status
SELECT 
  u.id, 
  u.email, 
  u.email_confirmed_at IS NOT NULL AS is_email_confirmed,
  p.role, 
  p.status AS profile_status,
  u.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
ORDER BY u.created_at DESC;
