/**
 * AERO — Apply profiles migration using Supabase Management API
 * This uses the Supabase Management API to run SQL directly.
 */

const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const PROJECT_REF = 'mfsmlyiwhejmwhpgemns';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars');
  process.exit(1);
}

const MIGRATION_SQL = `
-- 1. Create the update_updated_at_column function if not exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'ambulance' CHECK (role IN ('ambulance', 'police', 'hospital', 'admin')),
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  is_verified BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'active',
  badge_number TEXT,
  station_name TEXT,
  vehicle_number TEXT,
  hospital_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies (use IF NOT EXISTS pattern)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own profile' AND tablename = 'profiles') THEN
    CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own profile' AND tablename = 'profiles') THEN
    CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own profile' AND tablename = 'profiles') THEN
    CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access' AND tablename = 'profiles') THEN
    CREATE POLICY "Service role full access" ON public.profiles USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5. Updated_at trigger
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_profiles_modtime') THEN
    CREATE TRIGGER update_profiles_modtime
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();
  END IF;
END $$;

-- 6. Auto-create profile on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'ambulance'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 7. Seed profile for existing users who don't have one
INSERT INTO public.profiles (id, role, full_name)
SELECT 
  u.id,
  COALESCE(u.raw_user_meta_data->>'role', 'ambulance'),
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

-- 8. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
`;

async function main() {
  console.log('Attempting to apply migration via Supabase SQL endpoint...');
  console.log('');
  
  // Try using the Supabase project's pg_graphql or edge function SQL endpoint
  // The anon key cannot run DDL. We need to try the supabase CLI approach.
  
  // Approach: Use npx supabase to run the migration
  const { execSync } = require('child_process');
  
  // Write the SQL to a temp file
  const fs = require('fs');
  const sqlPath = path.resolve(__dirname, '..', 'supabase', 'migrations', '20260922_profiles_complete.sql');
  fs.writeFileSync(sqlPath, MIGRATION_SQL);
  console.log('Written migration SQL to:', sqlPath);
  console.log('');
  
  // Try pushing via supabase CLI
  try {
    console.log('Attempting: npx supabase db push...');
    const result = execSync('npx.cmd supabase db push --include-all', {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log('Result:', result);
  } catch (err) {
    console.log('supabase db push failed:', err.stderr || err.message);
    console.log('');
    console.log('Trying alternative: direct SQL via Supabase REST RPC...');
    
    // Alternative: Try using the Supabase SQL REST endpoint
    // Some Supabase projects expose sql endpoint
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ query: 'SELECT 1' }),
      });
      console.log('RPC test status:', res.status);
      const body = await res.text();
      console.log('RPC test body:', body);
    } catch (e2) {
      console.log('RPC also failed:', e2.message);
    }
    
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('MANUAL STEP REQUIRED');
    console.log('══════════════════════════════════════════════════');
    console.log('');
    console.log('The migration SQL has been saved to:');
    console.log(sqlPath);
    console.log('');
    console.log('Please open the Supabase SQL Editor:');
    console.log('  https://supabase.com/dashboard/project/mfsmlyiwhejmwhpgemns/sql/new');
    console.log('');
    console.log('Copy the SQL from the file above and paste it in the editor, then click RUN.');
  }
}

main().catch(err => {
  console.error('Script error:', err);
  process.exit(1);
});
