-- ==============================================================================
-- AERO — PostGIS spatial_ref_sys RLS Security Fix & Account Verification SQL
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FIX SUPABASE SECURITY ADVISOR WARNING: public.spatial_ref_sys
-- ------------------------------------------------------------------------------
-- RATIONALE:
-- `spatial_ref_sys` is a standard system reference table created by the PostGIS
-- extension. Supabase's Security Linter flags it because it resides in the
-- `public` schema without Row Level Security enabled.
-- Enabling RLS with a read-only policy for `public` satisfies the Security Advisor,
-- preserves all PostGIS spatial functions (ST_Transform, ST_SetSRID, etc.),
-- and strictly prevents unauthorized modifications via the PostgREST Data API.
-- ------------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'spatial_ref_sys'
  ) THEN
    -- Enable Row Level Security
    ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;

    -- Drop any pre-existing policy to avoid conflict
    DROP POLICY IF EXISTS "Allow read access to spatial_ref_sys" ON public.spatial_ref_sys;
    DROP POLICY IF EXISTS "Allow public read-only access to spatial_ref_sys" ON public.spatial_ref_sys;

    -- Allow read-only access for spatial queries
    CREATE POLICY "Allow public read-only access to spatial_ref_sys"
      ON public.spatial_ref_sys
      FOR SELECT
      TO public
      USING (true);

    RAISE NOTICE 'RLS enabled with read-only policy on public.spatial_ref_sys';
  END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 2. SAFE OPERATOR ACCOUNT INSPECTION & EMAIL CONFIRMATION
-- ------------------------------------------------------------------------------
-- Confirm the operator email so that Supabase GoTrue Auth no longer rejects
-- login attempts with 400 'Invalid login credentials' due to unconfirmed status.
-- ------------------------------------------------------------------------------

UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    confirmed_at = COALESCE(confirmed_at, NOW()),
    last_sign_in_at = COALESCE(last_sign_in_at, NOW())
WHERE email = 'hemanth118kumar@gmail.com';


-- ------------------------------------------------------------------------------
-- 3. ENSURE CORRESPONDING OPERATOR PROFILE EXISTS IN public.profiles
-- ------------------------------------------------------------------------------

INSERT INTO public.profiles (id, full_name, role, status)
SELECT 
  id,
  COALESCE(raw_user_meta_data->>'full_name', 'Hemanth Kumar'),
  COALESCE(raw_user_meta_data->>'role', 'ambulance'),
  'ACTIVE'
FROM auth.users
WHERE email = 'hemanth118kumar@gmail.com'
ON CONFLICT (id) DO UPDATE
SET status = 'ACTIVE',
    updated_at = NOW();


-- ------------------------------------------------------------------------------
-- 4. READ-ONLY DIAGNOSTIC VERIFICATION QUERY
-- ------------------------------------------------------------------------------
-- Returns the verified state of the operator account and profile:
-- ------------------------------------------------------------------------------

SELECT 
  u.id AS auth_user_id,
  u.email,
  u.email_confirmed_at,
  u.confirmed_at,
  u.created_at,
  p.role AS profile_role,
  p.status AS profile_status,
  p.full_name AS profile_name
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE u.email = 'hemanth118kumar@gmail.com';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
