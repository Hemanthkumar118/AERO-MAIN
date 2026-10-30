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
  organization?: string | null;
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

const AERO_PROFILE_STORAGE_KEY = 'aero-profile-cache';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<SupabaseUser | null>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
            const raw = localStorage.getItem(key);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed?.user) return parsed.user;
            }
          }
        }
      } catch {}
    }
    return null;
  });
  
  // Instant multi-tab cache restoration to prevent flashing 'Operator' 'UNKNOWN'
  const [profile, setProfileState] = useState<AeroProfile | null>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const cached = localStorage.getItem(AERO_PROFILE_STORAGE_KEY);
        if (cached) return JSON.parse(cached);
        const name = localStorage.getItem('aero-user-name');
        const role = localStorage.getItem('aero-user-role');
        if (name && role) {
          return { id: 'cached-id', full_name: name, role, status: 'APPROVED' } as AeroProfile;
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
    return null;
  });

  const setProfile = (newProfile: AeroProfile | null) => {
    setProfileState(newProfile);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        if (newProfile) {
          localStorage.setItem(AERO_PROFILE_STORAGE_KEY, JSON.stringify(newProfile));
          if (newProfile.full_name) localStorage.setItem('aero-user-name', newProfile.full_name);
          if (newProfile.role) localStorage.setItem('aero-user-role', newProfile.role);
        } else {
          localStorage.removeItem(AERO_PROFILE_STORAGE_KEY);
          localStorage.removeItem('aero-user-name');
          localStorage.removeItem('aero-user-role');
        }
      } catch {
        // Ignore storage write errors
      }
    }
  };

  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
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
        // Profile exists — use authoritative DB profile
        setProfile(data as AeroProfile);
      } else {
        // Profile doesn't exist in DB — check if an explicit registration role exists in user_metadata
        const requestedRole = currentUser.user_metadata?.role;
        const metadataFullName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email?.split('@')[0] || 'AERO Operator';
        
        if (requestedRole) {
          const newProfile = {
            id: currentUser.id,
            role: requestedRole,
            full_name: metadataFullName,
          };
          const { data: createdProfile, error: insertError } = await supabase
            .from('profiles')
            .insert(newProfile)
            .select('id, role, full_name, status')
            .single();

          if (insertError) {
            console.warn('[AuthProvider] Failed to create profile in DB, holding as pending:', insertError);
            setProfile({ ...newProfile, status: 'PENDING' } as AeroProfile);
          } else {
            setProfile(createdProfile as AeroProfile);
          }
        } else {
          // Unprovisioned or OAuth account: Do NOT automatically assign emergency privileges
          setProfile({
            id: currentUser.id,
            role: 'pending',
            full_name: metadataFullName,
            status: 'PENDING',
          } as AeroProfile);
        }
      }
    } catch (err: any) {
      console.warn('[AuthProvider] Profile fetch notice:', err);
      const metadataFullName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email?.split('@')[0] || 'AERO Operator';
      
      if (err?.message?.includes('recursion') || err?.code === '42P17') {
        setProfileError('Database RLS recursion detected on public.profiles. Please execute the migration supabase/migrations/20261025_fix_profiles_rls_recursion.sql in Supabase SQL Editor.');
        // Don't erase previously cached profile if present
        setProfileState(prev => prev || ({
          id: currentUser.id,
          role: currentUser.user_metadata?.role || 'pending',
          full_name: metadataFullName,
          status: 'PENDING',
        } as AeroProfile));
      } else if (currentUser?.email) {
        setProfile({
          id: currentUser.id,
          role: currentUser.user_metadata?.role || 'pending',
          full_name: metadataFullName,
          status: 'PENDING',
        } as AeroProfile);
      } else {
        setProfileError(err.message || 'Failed to load profile');
      }
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    // Immediately restore session from unified storage if available
    supabase.auth.getSession().then(async (res: any) => {
      if (!mounted) return;
      const existingSession = res.data?.session;
      if (existingSession?.user) {
        setSession(existingSession);
        setUser(existingSession.user);
        await fetchProfile(existingSession.user);
      }
      setAuthLoading(false);
    }).catch(() => {
      if (mounted) setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, newSession: Session | null) => {
      if (!mounted) return;
      
      setSession(newSession);
      setUser(newSession?.user ?? null);
      
      if (newSession?.user) {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
          await fetchProfile(newSession.user);
        }
      } else if (event === 'SIGNED_OUT') {
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
      setProfile(null);
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
