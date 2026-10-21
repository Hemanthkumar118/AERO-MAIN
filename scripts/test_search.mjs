import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY);

async function testEdgeFunction() {
  console.log('Testing search-hospitals edge function...');
  try {
    const { data, error } = await supabase.functions.invoke('search-hospitals', {
      body: {
        action: 'autocomplete',
        query: 'Apollo',
        latitude: 17.44,
        longitude: 78.34,
        radius: 15000
      }
    });
    console.log('Edge function response:', { data, error });
  } catch (err) {
    console.error('Edge function caught error:', err);
  }
}

testEdgeFunction();
