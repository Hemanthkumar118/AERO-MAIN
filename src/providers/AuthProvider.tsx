import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Session, User as SupabaseUser, AuthChangeEvent } from '@supabase/supabase-js';

// The AERO Profile structure corresponding to public.profiles table
// Matches: id, full_name, role, status, created_at, updated_at
export interface AeroProfile {
  id: string;
  role: string;
  full_name: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
  hospital_id?: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: SupabaseUser | null;
  profile: AeroProfile | null;
  authLoading: boolean;
  profileLoading: boolean;
  profileError: string | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  authLoading: true,
  profileLoading: true,
  profileError: null,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<AeroProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const fetchProfile = async (currentUser: SupabaseUser) => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, full_name, status')
        .eq('id', currentUser.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (data) {
        // Profile exists — use it
        setProfile(data as AeroProfile);
      } else {
        // Profile doesn't exist (PGRST116 or null) — auto-create one
        const newProfile = {
          id: currentUser.id,
          role: currentUser.user_metadata?.role || 'ambulance',
          full_name: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'AERO Operator',
        };
        const { data: createdProfile, error: insertError } = await supabase
          .from('profiles')
          .insert(newProfile)
          .select('id, role, full_name, status')
          .single();

        if (insertError) {
          console.warn('[AuthProvider] Failed to create profile in DB (RLS?), falling back to local metadata:', insertError);
          setProfile({ ...newProfile, status: 'ACTIVE' } as AeroProfile);
        } else {
          setProfile(createdProfile as AeroProfile);
        }
      }
    } catch (err: any) {
      console.error('[AuthProvider] Profile error:', err);
      setProfileError(err.message || 'Failed to load profile');
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, newSession: Session | null) => {
      if (!mounted) return;
      
      setSession(newSession);
      setUser(newSession?.user ?? null);
      
      if (newSession?.user) {
        // Fetch profile on initial load, sign in, or user update
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          await fetchProfile(newSession.user);
        }
      } else {
        setProfile(null);
        setProfileLoading(false);
      }
      
      if (mounted) {
        setAuthLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        authLoading,
        profileLoading,
        profileError,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
