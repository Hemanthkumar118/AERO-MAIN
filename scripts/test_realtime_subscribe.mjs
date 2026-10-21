import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY);

console.log('Testing channel subscription with existing vs non-existent tables...');

// Test 1: Subscribe to emergency_incidents only
const ch1 = supabase.channel('test-incidents')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_incidents' }, (payload) => {})
  .subscribe((status, err) => {
    console.log('Channel 1 (emergency_incidents):', status, err || '');
  });

// Test 2: Subscribe including non-existent table clinical_observations
const ch2 = supabase.channel('test-all-tables')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_incidents' }, (payload) => {})
  .on('postgres_changes', { event: '*', schema: 'public', table: 'clinical_observations' }, (payload) => {})
  .subscribe((status, err) => {
    console.log('Channel 2 (all tables):', status, err || '');
  });

setTimeout(() => {
  console.log('Done test.');
  process.exit(0);
}, 6000);
