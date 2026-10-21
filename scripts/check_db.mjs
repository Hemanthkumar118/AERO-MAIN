import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY);

async function check() {
  console.log('Testing Supabase queries with publishable key:');

  const { data: profiles, error: pErr } = await supabase.from('profiles').select('id, role, full_name, status');
  console.log('profiles:', { count: profiles?.length, error: pErr?.message, profiles });

  const { data: obs, error: oErr } = await supabase.from('clinical_observations').select('*').limit(5);
  console.log('clinical_observations:', { count: obs?.length, error: oErr?.message });

  const { data: incs, error: iErr } = await supabase.from('emergency_incidents').select('id, status, destination_hospital').limit(5);
  console.log('emergency_incidents:', { count: incs?.length, error: iErr?.message, incs });

  const { data: hosps, error: hErr } = await supabase.from('hospitals').select('id, name').limit(10);
  console.log('hospitals:', { count: hosps?.length, error: hErr?.message, hosps });
}

check();
