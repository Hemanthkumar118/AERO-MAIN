import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const supabase = createClient(process.env.VITE_SUPABASE_URL || '', process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '');

async function run() {
  const { error } = await supabase.rpc('execute_sql', {
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS unique_active_ambulance_incident ON public.emergency_incidents (user_id) WHERE status IN ('active', 'dispatched', 'en_route');`
  });
  console.log("Error:", error);
}
run();
