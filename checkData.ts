import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const supabase = createClient(process.env.VITE_SUPABASE_URL || '', process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '');

async function run() {
  const { data, error } = await supabase.from('emergency_incidents').select('*');
  console.log("Error:", error);
  console.log("Total incidents in DB:", data?.length);
  if (data) {
    const active = data.filter(d => ['active', 'dispatched', 'en_route'].includes(d.status));
    console.log("Active incidents:", active.length);
    active.forEach(a => console.log(`ID: ${a.id}, Ambulance: ${a.ambulance_id}, Hosp: ${a.destination_hospital}, Status: ${a.status}`));
  }
}
run();
