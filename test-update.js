import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function test() {
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: 'yashr4635@gmail.com', // user from screenshot
    password: 'password123' // assuming default password
  });

  if (signInError) {
    console.error('Sign in error:', signInError);
    return;
  }

  const userId = signInData.user.id;
  console.log('User ID:', userId);

  const { data: rpcData, error: rpcError } = await supabase.rpc('get_or_create_hospital', {
    p_name: 'Malkajgiri',
    p_address: 'Malkajgiri, Hyderabad',
    p_lat: 17.44,
    p_lng: 78.34,
    p_phone: '1234567890'
  });

  if (rpcError) {
    console.error('RPC Error:', rpcError);
  } else {
    console.log('RPC Data:', rpcData);
    
    const { error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: 'yash',
          hospital_id: rpcData || null
        })
        .eq('id', userId);
        
    if (updateError) {
        console.error('Update Error:', updateError);
    } else {
        console.log('Update Success!');
    }
  }
}

test();
