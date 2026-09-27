import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY);

async function run() {
  console.log('Fetching all incidents...');
  const { data, error } = await supabase.from('emergency_incidents').select('id');
  if (error) {
    console.error(error);
    return;
  }
  
  if (data && data.length > 0) {
    const ids = data.map(d => d.id);
    console.log(`Deleting ${ids.length} old incidents...`);
    const { error: delError } = await supabase.from('emergency_incidents').delete().in('id', ids);
    if (delError) {
      console.error("Delete error:", delError);
    } else {
      console.log('Successfully cleared all incidents.');
    }
  } else {
    console.log('No incidents found to delete.');
  }
}

run();
