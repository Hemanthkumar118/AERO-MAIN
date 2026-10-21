import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isConfigured) {
  console.warn(
    'AERO Configuration Error\n\nMissing:\n- VITE_SUPABASE_URL\n- VITE_SUPABASE_PUBLISHABLE_KEY\n\nAdd these values to .env and restart the development server to enable authentication and backend features.'
  );
}

const createMockSupabase = () => {
  const notConfiguredError = { error: new Error('Supabase is not configured. Please add credentials to .env') };
  
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getUser: async () => ({ data: { user: null }, error: null }),
      signInWithPassword: async () => notConfiguredError,
      signInWithOAuth: async () => notConfiguredError,
      signUp: async () => notConfiguredError,
      signOut: async () => ({ error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ order: async () => ({ data: [], error: notConfiguredError.error }) }),
        order: async () => ({ data: [], error: notConfiguredError.error })
      }),
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: notConfiguredError.error }) }) })
    })
  } as any;
};

// Unified session storage key across all routes so mobile navigation and reloads stay logged in
const AERO_STORAGE_KEY = 'aero-auth-session';

// Migrate any legacy route-specific session keys to the unified key
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    if (!localStorage.getItem(AERO_STORAGE_KEY)) {
      const legacyKeys = [
        'aero-session-default',
        'aero-session-ambulance',
        'aero-session-police',
        'aero-session-hospital',
        'aero-session-admin',
        'aero-session'
      ];
      for (const key of legacyKeys) {
        const val = localStorage.getItem(key);
        if (val) {
          localStorage.setItem(AERO_STORAGE_KEY, val);
          break;
        }
      }
    }
  } catch {
    // Ignore storage migration errors
  }
}

export const supabase = isConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        storageKey: AERO_STORAGE_KEY,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      }
    }) 
  : createMockSupabase();
