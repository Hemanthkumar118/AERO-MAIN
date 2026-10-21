-- ==============================================================================
-- AERO — Complete RLS Infinite Recursion Fix & Role Protection Migration
-- File: supabase/migrations/20261025_fix_profiles_rls_recursion.sql
-- ==============================================================================

-- 1. Ensure role check constraint includes 'pending'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check 
  CHECK (role IN ('ambulance', 'police', 'hospital', 'admin', 'traffic_operator', 'hospital_operator', 'ambulance_operator', 'pending'));

-- 2. Create SECURITY DEFINER helper functions to break RLS recursion completely
-- These functions run with database owner privileges (BYPASSRLS), bypassing RLS on public.profiles

CREATE OR REPLACE FUNCTION public.is_admin_or_dispatcher(check_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = check_user_id
      AND role IN ('admin', 'traffic_operator')
      AND status = 'ACTIVE'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(check_user_id UUID DEFAULT auth.uid())
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = check_user_id LIMIT 1;
$$;

-- 3. Drop all potentially recursive policies on public.profiles
DROP POLICY IF EXISTS "Users can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- 4. Create clean, non-recursive policies on public.profiles
-- Rule 1: Authenticated users can read their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Rule 2: Authorized administrators and dispatchers can view all profiles
-- Evaluated strictly via SECURITY DEFINER function to prevent recursion
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.is_admin_or_dispatcher(auth.uid()));

-- Rule 3: Authenticated users can insert only their own profile
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- Rule 4: Authenticated users can update only their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 5. Prevent self-role elevation via BEFORE UPDATE trigger
CREATE OR REPLACE FUNCTION public.prevent_self_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- If role or status is being altered:
  IF (OLD.role IS DISTINCT FROM NEW.role OR OLD.status IS DISTINCT FROM NEW.status) THEN
    -- Only active administrators or service_role can approve/alter roles
    IF NOT public.is_admin_or_dispatcher(auth.uid()) AND auth.role() <> 'service_role' THEN
      NEW.role := OLD.role;
      NEW.status := OLD.status;
    END IF;
  END IF;
  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_role_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_self_role_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_role_escalation();

-- 6. Update user creation trigger so Google OAuth signups default safely to 'pending'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
  v_full_name TEXT;
  v_badge TEXT;
  v_vehicle TEXT;
  v_hospital_id UUID;
  v_status TEXT;
BEGIN
  v_role := LOWER(COALESCE(NEW.raw_user_meta_data->>'role', ''));

  -- If explicit valid registration role was provided in metadata:
  IF v_role IN ('ambulance', 'police', 'hospital', 'admin', 'traffic_operator', 'hospital_operator', 'ambulance_operator') THEN
    v_status := 'ACTIVE';
  ELSE
    -- Unprovisioned or OAuth account: Hold in secure pending state
    v_role := 'pending';
    v_status := 'PENDING';
  END IF;

  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );
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
    v_status,
    v_badge,
    v_vehicle,
    v_hospital_id,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Update other policies that query profiles to use helper functions instead of inline subqueries
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins and Traffic Police can manage coordination plans' AND tablename = 'police_coordination_plans') THEN
    DROP POLICY "Admins and Traffic Police can manage coordination plans" ON public.police_coordination_plans;
    CREATE POLICY "Admins and Traffic Police can manage coordination plans" ON public.police_coordination_plans
      FOR ALL USING (
        public.get_user_role(auth.uid()) IN ('traffic_operator', 'admin', 'ambulance')
      );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Officers view assigned or relevant assignments' AND tablename = 'police_route_assignments') THEN
    DROP POLICY "Officers view assigned or relevant assignments" ON public.police_route_assignments;
    CREATE POLICY "Officers view assigned or relevant assignments" ON public.police_route_assignments
      FOR SELECT USING (
        police_id = auth.uid() OR 
        public.get_user_role(auth.uid()) IN ('traffic_operator', 'admin', 'ambulance')
      );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Officers update own assignments' AND tablename = 'police_route_assignments') THEN
    DROP POLICY "Officers update own assignments" ON public.police_route_assignments;
    CREATE POLICY "Officers update own assignments" ON public.police_route_assignments
      FOR UPDATE USING (
        police_id = auth.uid() OR 
        public.get_user_role(auth.uid()) IN ('traffic_operator', 'admin')
      );
  END IF;
END $$;

-- 8. Correct registered database hospitals eligibility
-- Mark alternative healthcare or test records as non-emergency
UPDATE public.hospitals
SET emergency_capable = false
WHERE name ILIKE '%ayurveda%' 
   OR name ILIKE '%homeopathy%'
   OR name ILIKE '%wellness%'
   OR name ILIKE '%test%'
   OR latitude = 0
   OR longitude = 0;

-- 9. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
