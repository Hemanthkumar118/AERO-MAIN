import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { Button } from '../../../components/ui/Button';

export function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecovery, setIsRecovery] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    const handleAuthCallback = async () => {
      try {
        const hash = window.location.hash;
        const search = window.location.search;
        let recoveryDetected = false;

        // 1. Check for error parameters in hash or search query
        const searchParams = new URLSearchParams(search || '');
        const hashParams = hash ? new URLSearchParams(hash.substring(1)) : null;

        const checkParamsForError = (params: URLSearchParams) => {
          if (params.get('error')) {
            const errCode = params.get('error_code');
            const errDesc = params.get('error_description');
            if (errCode === 'otp_expired' || errDesc?.toLowerCase().includes('expired')) {
              throw new Error('This verification or recovery link has expired. Please request a new one from the sign-in page.');
            } else {
              throw new Error(errDesc?.replace(/\+/g, ' ') || 'Authentication verification failed.');
            }
          }
        };

        if (hashParams) {
          checkParamsForError(hashParams);
          if (hashParams.get('type') === 'recovery') {
            recoveryDetected = true;
          }
        }

        checkParamsForError(searchParams);
        if (searchParams.get('type') === 'recovery') {
          recoveryDetected = true;
        }

        // 2. Exchange code for session if PKCE code is provided in URL
        const code = searchParams.get('code');
        let session = null;

        if (code) {
          const { data: codeData, error: codeError } = await supabase.auth.exchangeCodeForSession(code);
          if (codeError) throw codeError;
          session = codeData?.session ?? null;
        } else {
          const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          session = sessionData?.session ?? null;
        }

        // If recovery was detected in the URL, validate active session
        if (recoveryDetected) {
          let activeSession = session;
          if (!activeSession?.user) {
            // Allow brief grace period for Supabase to parse hash tokens
            await new Promise((resolve) => setTimeout(resolve, 800));
            const { data: retryData } = await supabase.auth.getSession();
            activeSession = retryData?.session ?? null;
          }

          if (!activeSession?.user) {
            throw new Error('Your password recovery link is invalid or has expired. Please request a new link from the sign-in page.');
          }

          if (!mounted) return;
          setIsRecovery(true);
          setLoading(false);
          return;
        }

        if (!session || !session.user) {
          throw new Error('No active authentication session found. Please sign in with your email and password.');
        }

        // 3. Email confirmation / verification: fetch authoritative profile
        let authoritativeRole = (session.user.user_metadata?.role || 'ambulance').toLowerCase();

        try {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('role, status')
            .eq('id', session.user.id)
            .maybeSingle();

          if (profileData) {
            if (profileData.status && ['SUSPENDED', 'BLOCKED', 'DEACTIVATED'].includes(profileData.status.toUpperCase())) {
              await supabase.auth.signOut();
              throw new Error('Your operator account has been suspended. Please contact dispatch administration.');
            }
            if (profileData.role) {
              authoritativeRole = profileData.role.toLowerCase();
            }
          } else {
            // Profile record not found yet — auto-create active profile for confirmed user
            await supabase.from('profiles').upsert({
              id: session.user.id,
              role: authoritativeRole,
              full_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'AERO Operator',
              status: 'ACTIVE'
            }, { onConflict: 'id' });
          }
        } catch (profErr: any) {
          if (profErr.message?.includes('suspended')) {
            throw profErr;
          }
          console.warn('[AuthCallback] Profile resolution notice:', profErr);
        }

        if (!mounted) return;
        setLoading(false);

        // 4. Route directly to authorized dashboard
        switch (authoritativeRole) {
          case 'ambulance_operator':
          case 'ambulance':
            navigate('/ambulance', { replace: true });
            break;
          case 'traffic_operator':
          case 'police':
            navigate('/police', { replace: true });
            break;
          case 'hospital_operator':
          case 'hospital':
            navigate('/hospital', { replace: true });
            break;
          case 'admin':
            navigate('/admin', { replace: true });
            break;
          default:
            navigate('/ambulance', { replace: true });
        }
      } catch (err: any) {
        if (!mounted) return;
        setError(err.message || 'An error occurred during authentication verification.');
        setLoading(false);
      }
    };

    handleAuthCallback();

    // Listen for auth state change event (e.g. PASSWORD_RECOVERY)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: any, authSession: any) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') {
        if (authSession?.user) {
          setIsRecovery(true);
          setLoading(false);
        } else {
          const { data } = await supabase.auth.getSession();
          if (data?.session?.user) {
            setIsRecovery(true);
            setLoading(false);
          } else {
            setError('Your password recovery link is invalid or has expired. Please request a new link from the sign-in page.');
            setLoading(false);
          }
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    const cleanPass = newPassword.trim();
    if (!cleanPass) {
      setPasswordError('Please enter a new password.');
      return;
    }

    if (cleanPass.length < 8) {
      setPasswordError('Password must be at least 8 characters long.');
      return;
    }

    if (cleanPass !== confirmPassword.trim()) {
      setPasswordError('Passwords do not match.');
      return;
    }

    setIsUpdatingPassword(true);
    try {
      // Validate active session exists before updateUser
      const { data: currentSession } = await supabase.auth.getSession();
      if (!currentSession?.session?.user) {
        throw new Error('Your recovery session has expired. Please request a new password recovery link.');
      }

      const { error: updateErr } = await supabase.auth.updateUser({
        password: cleanPass,
      });

      if (updateErr) {
        throw updateErr;
      }

      setPasswordUpdated(true);

      // Clean up the temporary recovery session so the user signs in with fresh credentials
      try {
        await supabase.auth.signOut();
      } catch (signOutErr) {
        console.warn('[AuthCallback] Post-recovery sign out notice:', signOutErr);
      }

      setTimeout(() => {
        navigate('/login', { replace: true, state: { resetSuccess: true } });
      }, 2000);
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to update password. Please request a new recovery link.');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-aero-background p-4">
        <div className="w-16 h-16 rounded-full border-4 border-aero-border border-t-[#35C7FF] animate-spin mb-4"></div>
        <h2 className="text-xl font-bold text-aero-text-primary">Verifying Authentication...</h2>
        <p className="text-aero-text-secondary mt-2">Please wait while we confirm your credentials.</p>
      </div>
    );
  }

  // Password Recovery Mode: Render Password Reset Form
  if (isRecovery) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-aero-background p-4">
        <div className="w-full max-w-md bg-[#0F172A] border border-white/10 rounded-2xl p-8 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-[#E53935]/15 border border-[#E53935]/30 mx-auto flex items-center justify-center mb-6">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E53935" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>

          <h2 className="text-2xl font-black text-white text-center tracking-tight mb-2">Reset Password</h2>
          <p className="text-xs text-slate-400 text-center mb-6">
            Create a new password for your AERO operator account.
          </p>

          {passwordUpdated ? (
            <div className="bg-[#12B981]/15 border border-[#12B981]/30 rounded-xl p-5 text-center space-y-2">
              <p className="text-sm font-bold text-[#12B981]">Password updated successfully!</p>
              <p className="text-xs text-slate-300">Redirecting to sign-in page...</p>
            </div>
          ) : (
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              {passwordError && (
                <div className="bg-[#E53935]/15 border border-[#E53935]/30 rounded-xl p-3 text-xs text-[#E53935] font-medium">
                  {passwordError}
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Enter at least 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={isUpdatingPassword}
                    className="aero-input w-full pr-14 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold text-slate-400 hover:text-white uppercase"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                  Confirm New Password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isUpdatingPassword}
                  className="aero-input w-full text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={isUpdatingPassword}
                className="w-full py-3 rounded-xl bg-[#E53935] hover:bg-[#ef5350] text-white text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-50 mt-2"
              >
                {isUpdatingPassword ? 'UPDATING PASSWORD...' : 'SET NEW PASSWORD'}
              </button>
            </form>
          )}

          <div className="mt-6 pt-4 border-t border-white/5 text-center">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="text-xs text-slate-400 hover:text-white"
            >
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Error State: Display Clear, Actionable Message
  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-aero-background p-4">
        <div className="w-full max-w-md bg-aero-surface border border-aero-red/30 rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-aero-red/20 border border-aero-red/30 mx-auto flex items-center justify-center mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-aero-text-primary mb-2">Authentication Error</h2>
          <p className="text-red-400 mb-8 text-sm leading-relaxed">{error}</p>
          
          <div className="space-y-3">
            <Button variant="primary" fullWidth onClick={() => navigate('/login')}>
              RETURN TO SIGN IN
            </Button>
            <Button variant="outline" fullWidth onClick={() => navigate('/register')}>
              REGISTER NEW ACCOUNT
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
