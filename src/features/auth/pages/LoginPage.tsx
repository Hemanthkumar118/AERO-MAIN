import { useState, useEffect } from 'react';
import type { UserRole } from '../../../types';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { validateEmailAddress } from '../../../utils/emailValidation';
import { getRemainingCooldown, setCooldown } from '../../../utils/authCooldown';


interface LoginPageProps {
  onLogin: (role: string) => void;
}

const ROLES: { role: UserRole; label: string; sublabel: string; color: string; activeBg: string; activeBorder: string }[] = [
  {
    role: 'AMBULANCE',
    label: 'Ambulance',
    sublabel: 'Paramedic / Driver',
    color: 'text-[#E53935]',
    activeBg: 'bg-[#E53935]/10',
    activeBorder: 'border-[#E53935]/50',
  },
  {
    role: 'POLICE',
    label: 'Traffic Police',
    sublabel: 'Traffic Authority',
    color: 'text-aero-amber',
    activeBg: 'bg-aero-amber-soft',
    activeBorder: 'border-[#FFB020]/50',
  },
  {
    role: 'HOSPITAL',
    label: 'Hospital ER',
    sublabel: 'Clinical Staff',
    color: 'text-[#20C997]',
    activeBg: 'bg-[#20C997]/10',
    activeBorder: 'border-[#20C997]/50',
  },
  {
    role: 'ADMIN',
    label: 'Command Center',
    sublabel: 'Administrator',
    color: 'text-[#19C6D8]',
    activeBg: 'bg-[#19C6D8]/10',
    activeBorder: 'border-[#19C6D8]/50',
  },
];

const ROLE_PLACEHOLDERS: Record<UserRole, string> = {
  AMBULANCE: 'paramedic@agency.org',
  POLICE: 'officer@traffic-dept.gov',
  HOSPITAL: 'er.staff@hospital-network.com',
  ADMIN: 'admin@emergency-command.org',
};

// SVG icons for each role
const RoleIcons: Record<UserRole, React.ReactNode> = {
  AMBULANCE: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
    </svg>
  ),
  POLICE: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  HOSPITAL: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M12 8v8M8 12h8"/>
    </svg>
  ),
  ADMIN: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
    </svg>
  ),
};

export function LoginPage({ onLogin }: LoginPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedRole, setSelectedRole] = useState<UserRole>('AMBULANCE');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorCategory, setErrorCategory] = useState<'credentials' | 'unconfirmed' | 'pending' | 'unassigned' | 'rls' | 'network' | 'timeout' | 'general'>('general');
  const [infoNotice, setInfoNotice] = useState('');
  const [isUnconfirmed, setIsUnconfirmed] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [modalTab, setModalTab] = useState<'reset' | 'resend'>('reset');
  const [resetEmail, setResetEmail] = useState('');
  const [modalSuccess, setModalSuccess] = useState('');
  const [modalError, setModalError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(() => getRemainingCooldown('resend_confirmation'));
  const [resetCooldown, setResetCooldown] = useState(() => getRemainingCooldown('password_reset'));
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    setError('');
    setInfoNotice('');

    try {
      const redirectUrl = `${window.location.origin}/auth/callback`;
      console.info('[AERO Auth Diagnostic] Initiating Google OAuth via signInWithOAuth:', {
        redirectTo: redirectUrl,
        provider: 'google',
        timestamp: new Date().toISOString()
      });

      const { data, error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (oauthErr) {
        throw oauthErr;
      }

      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      console.warn('[AERO Auth Diagnostic] Google OAuth error:', {
        message: err.message,
        status: err.status,
        timestamp: new Date().toISOString()
      });
      setError(err.message || 'Google sign-in could not be initialized. Please check network or contact administrator.');
      setIsGoogleLoading(false);
    }
  };

  // Notification from password reset redirect
  useEffect(() => {
    if ((location.state as any)?.resetSuccess) {
      setInfoNotice('Your password has been successfully reset! Please sign in with your new credentials.');
      try {
        window.history.replaceState({}, document.title);
      } catch {}
    }
  }, [location.state]);

  // Live countdown timer for active action cooldowns
  useEffect(() => {
    const interval = setInterval(() => {
      const resendLeft = getRemainingCooldown('resend_confirmation');
      const resetLeft = getRemainingCooldown('password_reset');
      setResendCooldown(resendLeft);
      setResetCooldown(resetLeft);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleResendConfirmation = async (targetEmail?: string) => {
    const rawEmail = (typeof targetEmail === 'string' ? targetEmail : (resetEmail || identifier)).trim().toLowerCase();
    if (!rawEmail) {
      const msg = 'Please enter your email address to resend confirmation.';
      setError(msg);
      setModalError(msg);
      setModalTab('resend');
      setShowResetModal(true);
      return;
    }

    const validation = validateEmailAddress(rawEmail);
    if (!validation.isValid) {
      const msg = validation.error || 'Please enter a valid email address.';
      setError(msg);
      setModalError(msg);
      return;
    }

    const remaining = getRemainingCooldown('resend_confirmation');
    if (remaining > 0) {
      const msg = `Security cooldown active: please wait ${remaining}s before requesting another confirmation email.`;
      setError(msg);
      setModalError(msg);
      return;
    }

    setIsActionLoading(true);
    setError('');
    setModalError('');
    setModalSuccess('');
    setInfoNotice('');
    try {
      const redirectUrl = `${window.location.origin}/auth/callback`;
      const { error: resendErr } = await supabase.auth.resend({
        type: 'signup',
        email: validation.normalizedEmail,
        options: {
          emailRedirectTo: redirectUrl,
        }
      });

      if (resendErr) {
        const msg = resendErr.message || '';
        const isRateLimited = resendErr.status === 429 ||
          (resendErr as any).code === 'over_email_send_rate_limit' ||
          msg.toLowerCase().includes('rate limit') ||
          msg.toLowerCase().includes('once every');

        if (isRateLimited) {
          setCooldown('resend_confirmation', 60);
          setResendCooldown(60);
          const limitMsg = 'Email rate limit reached. Supabase permits one email per minute. Please wait before retrying.';
          setError(limitMsg);
          setModalError(limitMsg);
        } else {
          setError(msg || 'Failed to resend confirmation email.');
          setModalError(msg || 'Failed to resend confirmation email.');
        }
      } else {
        setCooldown('resend_confirmation', 60);
        setResendCooldown(60);
        const successMsg = `Confirmation email sent to ${validation.normalizedEmail}! Please check your inbox and spam folder.`;
        setInfoNotice(successMsg);
        setModalSuccess(successMsg);
        setIsUnconfirmed(false);
      }
    } catch (err: any) {
      const msg = err.message || 'An error occurred while resending confirmation email.';
      setError(msg);
      setModalError(msg);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSendPasswordReset = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setModalError('');
    setModalSuccess('');
    const rawEmail = (resetEmail || identifier).trim().toLowerCase();
    if (!rawEmail) {
      setModalError('Please enter your account email address.');
      return;
    }

    const validation = validateEmailAddress(rawEmail);
    if (!validation.isValid) {
      setModalError(validation.error || 'Please enter a valid email address.');
      return;
    }

    const remaining = getRemainingCooldown('password_reset');
    if (remaining > 0) {
      setModalError(`Security cooldown active: please wait ${remaining}s before requesting another password reset.`);
      return;
    }

    setIsActionLoading(true);
    setError('');
    try {
      const redirectUrl = `${window.location.origin}/auth/callback`;
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(validation.normalizedEmail, {
        redirectTo: redirectUrl,
      });

      if (resetErr) {
        const msg = resetErr.message || '';
        const isRateLimited = resetErr.status === 429 ||
          (resetErr as any).code === 'over_email_send_rate_limit' ||
          msg.toLowerCase().includes('rate limit') ||
          msg.toLowerCase().includes('once every');

        if (isRateLimited) {
          setCooldown('password_reset', 60);
          setResetCooldown(60);
          setModalError('Email rate limit reached. Supabase permits one recovery email per minute. Please wait before retrying.');
        } else {
          setModalError(msg || 'Could not send password reset email.');
        }
      } else {
        setCooldown('password_reset', 60);
        setResetCooldown(60);
        const successMsg = `Password recovery instructions sent to ${validation.normalizedEmail}. Please check your inbox and follow the recovery link.`;
        setModalSuccess(successMsg);
        setInfoNotice(successMsg);
      }
    } catch (err: any) {
      setModalError(err.message || 'Failed to request password reset.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawEmail = identifier.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!rawEmail || !cleanPassword) {
      setError('Please enter both email and password.');
      return;
    }

    // Syntax validation for login (allows any domain existing in Supabase auth)
    const emailValidation = validateEmailAddress(rawEmail, { checkDeliverability: false });
    if (!emailValidation.isValid) {
      setError(emailValidation.error || 'Please enter a valid official email address.');
      return;
    }

    const cleanEmail = emailValidation.normalizedEmail;
    
    setIsLoading(true);
    setError('');
    setInfoNotice('');
    setIsUnconfirmed(false);
    
    console.info('[AERO Auth Diagnostic] Initiating signInWithPassword:', {
      domain: cleanEmail.includes('@') ? cleanEmail.split('@')[1] : 'unknown',
      endpointConfigured: Boolean(import.meta.env.VITE_SUPABASE_URL),
      timestamp: new Date().toISOString()
    });
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('TIMEOUT')), 15000)
    );

    try {
      const signInPromise = supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword,
      });

      const { data, error } = await Promise.race([signInPromise, timeoutPromise]) as any;

      if (error) {
        console.warn('[AERO Auth Diagnostic] Supabase Auth rejected credentials (POST /token 400):', {
          status: error.status,
          code: error.code,
          message: error.message,
          timestamp: new Date().toISOString()
        });

        const msg = (error.message || '').toLowerCase();
        if (msg.includes('email not confirmed') || error.code === 'email_not_confirmed') {
          setIsUnconfirmed(true);
          setErrorCategory('unconfirmed');
          setError('Your email address has not been confirmed yet. Please verify your inbox or click "Resend confirmation email" below.');
          return;
        }
        if (msg.includes('invalid login credentials') || error.code === 'invalid_credentials') {
          setIsUnconfirmed(true);
          setErrorCategory('credentials');
          setError('Invalid email or password. Please verify your credentials or use the account recovery options below.');
          return;
        }
        if (msg.includes('rate limit')) {
          setErrorCategory('general');
          setError('Too many login attempts. Please wait a moment and try again.');
          return;
        }
        setErrorCategory('general');
        setError(error.message || 'Authentication failed. Please verify your credentials.');
        return;
      }

      if (!data?.session || !data?.user) {
        setErrorCategory('general');
        setError("Authentication succeeded but no active session was returned by the server.");
        return;
      }

      console.info('[AERO Auth Diagnostic] Supabase credentials accepted. Inspecting public.profiles:', {
        userId: data.user.id,
        timestamp: new Date().toISOString()
      });

      // Authoritative profile lookup from public.profiles
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, role, full_name, status')
        .eq('id', data.user.id)
        .maybeSingle();

      if (profileError) {
        console.error('[AERO Auth Diagnostic] Profile lookup error:', profileError);
        await supabase.auth.signOut();
        setErrorCategory('rls');
        if (profileError.code === '42P17' || profileError.message?.includes('recursion')) {
          setError('Authentication succeeded, but profile verification failed due to a database RLS recursion policy error. Please run the database repair migration in Supabase SQL editor.');
        } else {
          setError(`Authentication succeeded, but profile verification failed (${profileError.message || 'database security policy'}). Please contact dispatch administration.`);
        }
        return;
      }

      console.info('[AERO Auth Diagnostic] Profile lookup result:', {
        hasProfile: Boolean(profileData),
        role: profileData?.role || 'NONE',
        status: profileData?.status || 'NONE',
        timestamp: new Date().toISOString()
      });

      // Check account operational status if profile exists
      if (profileData?.status && ['SUSPENDED', 'BLOCKED', 'DEACTIVATED'].includes(profileData.status.toUpperCase())) {
        await supabase.auth.signOut();
        setErrorCategory('general');
        setError('Your operator account has been suspended. Please contact dispatch administration.');
        return;
      }

      if (profileData?.status && profileData.status.toUpperCase() === 'PENDING') {
        await supabase.auth.signOut();
        setErrorCategory('pending');
        setError('Your registration is verified, but awaiting administrator approval before dashboard access can be granted.');
        return;
      }

      if (!profileData) {
        // Safe profile creation for partial registrations (account exists in auth.users without public.profiles record)
        const authoritativeRole = (data.user.user_metadata?.role || selectedRole.toLowerCase() || 'ambulance').toLowerCase();
        const newProfile = {
          id: data.user.id,
          role: authoritativeRole,
          full_name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'AERO Operator',
          status: 'ACTIVE'
        };

        const { data: createdProfile, error: createError } = await supabase
          .from('profiles')
          .insert(newProfile)
          .select('id, role, full_name, status')
          .single();

        if (createError) {
          console.warn('[Login] Could not persist profile to DB (RLS):', createError);
          await supabase.auth.signOut();
          setErrorCategory('unassigned');
          setError('Account authenticated, but your operator profile could not be initialized in the database. Please contact dispatch administration.');
          return;
        } else {
          onLogin(createdProfile.role);
        }
      } else {
        if (!profileData.role || profileData.role.toLowerCase() === 'pending' || profileData.role.toLowerCase() === 'unassigned') {
          await supabase.auth.signOut();
          setErrorCategory('unassigned');
          setError('Account authenticated, but your operator role is unassigned or pending authorization. Please contact dispatch administration.');
          return;
        }
        // Check role consistency: navigate safely to their authorized role dashboard
        onLogin(profileData.role);
      }
    } catch (err: any) {
      console.error('Login error:', err);
      if (err.message === 'TIMEOUT') {
        setErrorCategory('timeout');
        setError("Authentication request timed out. Please check your network connection and retry.");
      } else if (err.message === 'Failed to fetch' || err.message === 'NetworkError') {
        setErrorCategory('network');
        setError("Unable to connect to authentication server. Please check your connection.");
      } else {
        setErrorCategory('general');
        setError(err.message || 'An unexpected error occurred during sign in. Please retry.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="min-h-screen flex bg-aero-background font-sans" style={{ colorScheme: 'dark' }}
    >

      {/* ── LEFT: Cinematic image panel ── */}
      <div className="hidden lg:flex flex-col w-[520px] shrink-0 relative overflow-hidden">
        {/* Hero Image */}
        <motion.div
          initial={{ scale: 1.04 }}
          animate={{ scale: 1, x: [0, 3, 0], y: [0, 2, 0] }}
          transition={{
            scale: { duration: 1.4, ease: 'easeOut' },
            x: { duration: 18, repeat: Infinity, ease: 'linear' },
            y: { duration: 22, repeat: Infinity, ease: 'linear' }
          }}
          className="absolute inset-0 w-full h-full"
        >
          <img
            src="/corridor_clearing.jpg"
            alt="Traffic police clearing emergency corridor"
            className="w-full h-full object-cover object-center"
          />
        </motion.div>
        {/* Dark cinematic overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#07090C] via-[#07090C]/70 to-[#07090C]/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#07090C]/40" />

        {/* Content over the image */}
        <div className="relative z-10 flex flex-col h-full p-12">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="flex items-center gap-3"
          >
            <div className="w-10 h-10 rounded-xl bg-[#E53935] flex items-center justify-center shadow-[0_0_20px_rgba(229,57,53,0.4)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z" fill="white" opacity="0.95"/>
                <path d="M9 12h6M12 9v6" stroke="#07090C" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <p className="text-white font-black text-xl leading-none tracking-tight">AERO</p>
              <p className="text-white/50 font-bold text-[9px] uppercase tracking-[0.2em] mt-0.5">Emergency Response Network</p>
            </div>
          </motion.div>

          {/* Bottom copy */}
          <div className="mt-auto">
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="text-white/60 text-xs font-bold uppercase tracking-widest mb-4"
            >
              Active Status
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="text-3xl font-black text-white leading-tight mb-4"
            >
              Every second<br/>matters.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="text-white/60 text-sm font-medium leading-relaxed max-w-xs"
            >
              Connecting ambulances, traffic authorities and hospitals through one real-time coordination platform.
            </motion.p>

            {/* Status indicators */}
            <div className="mt-8 space-y-3">
              {[
                { label: 'Live Response Network', status: 'ONLINE', color: '#20C997', delay: 0 },
                { label: 'Traffic Authority Link', status: 'ACTIVE', color: '#20C997', delay: 0.8 },
                { label: 'Hospital ER Bridge', status: 'READY', color: '#20C997', delay: 1.6 },
              ].map((item, i) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + (i * 0.1), duration: 0.5 }}
                  className="flex items-center justify-between border border-white/10 rounded-lg px-4 py-2.5 bg-white/5 backdrop-blur-sm"
                >
                  <span className="text-white/70 text-xs font-medium">{item.label}</span>
                  <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: item.color }}>
                    <motion.span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                      animate={{ opacity: [1, 0.45, 1] }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: item.delay }}
                    />
                    {item.status}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT: Authentication panel ── */}
      <div className="flex-1 flex flex-col justify-center px-6 py-12 lg:px-12 bg-aero-surface relative">
        {/* Subtle grid texture */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }} />

        <div className="relative z-10 sm:mx-auto sm:w-full sm:max-w-md">
          {/* Mobile Logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-[#E53935] flex items-center justify-center shadow-[0_0_16px_rgba(229,57,53,0.4)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z" fill="white"/>
                <path d="M9 12h6M12 9v6" stroke="#07090C" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-white font-black text-xl tracking-tight">AERO</span>
          </div>

          <div className="relative">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.3, ease: 'easeOut' }}
              className="mb-8"
            >
              <p className="text-[#A7ADB5] text-xs font-bold uppercase tracking-widest mb-2 transition-colors focus-within:text-white">Operator Sign In</p>
              <h2 className="text-2xl font-black text-white tracking-tight">Access AERO</h2>
            </motion.div>

            {/* Role Selection */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.3, ease: 'easeOut' }}
              className="mb-6"
            >
              <p className="text-xs font-bold text-[#A7ADB5] uppercase tracking-widest mb-3">Select Role</p>
              <div className="grid grid-cols-2 gap-2">
                {ROLES.map(({ role, label, sublabel, color, activeBg, activeBorder }) => {
                  const active = selectedRole === role;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => { setSelectedRole(role); setError(''); }}
                      className={`
                        group relative flex items-center gap-2.5 p-3 rounded-xl border transition duration-200 text-left cursor-pointer
                        hover:-translate-y-[1px] hover:scale-[1.01]
                        ${active
                          ? `${activeBg} ${activeBorder} ${color}`
                          : 'bg-aero-surface border-[var(--color-border-subtle)] text-[#A7ADB5] hover:border-[rgba(255,255,255,0.12)] hover:text-white hover:bg-white/[0.02]'
                        }
                      `}
                    >
                      <span className={`shrink-0 transition-transform duration-200 group-hover:translate-x-[1px] ${active ? color : ''}`}>
                        {RoleIcons[role]}
                      </span>
                      <div className="min-w-0">
                        <p className={`text-[11px] font-bold leading-tight transition-colors ${active ? color : 'text-aero-text-primary'}`}>{label}</p>
                        <p className={`text-[9px] font-medium mt-0.5 truncate transition-colors ${active ? 'opacity-70' : 'text-aero-text-secondary'}`}>{sublabel}</p>
                      </div>
                      {active && (
                        <motion.div
                          layoutId="activeRoleDot"
                          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                          className={`absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full ${color.replace('text-', 'bg-')}`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <AnimatePresence mode="wait">
                {infoNotice && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-3 bg-[#12B981]/10 border border-[#12B981]/30 rounded-xl px-4 py-3 text-sm text-[#12B981] font-medium overflow-hidden"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    <span>{infoNotice}</span>
                  </motion.div>
                )}

                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={`space-y-3 rounded-xl px-4 py-3.5 text-sm font-medium overflow-hidden border ${
                      errorCategory === 'unconfirmed' || errorCategory === 'pending' || errorCategory === 'unassigned'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                        : errorCategory === 'network' || errorCategory === 'timeout'
                        ? 'bg-orange-500/10 border-orange-500/30 text-orange-200'
                        : 'bg-[#E53935]/10 border-[#E53935]/20 text-[#E53935]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {errorCategory === 'unconfirmed' || errorCategory === 'pending' || errorCategory === 'unassigned' ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0 text-amber-400 mt-0.5">
                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0 text-[#E53935] mt-0.5">
                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="leading-snug block">{error}</span>
                        {errorCategory === 'credentials' && (
                          <p className="text-xs text-white/70 font-normal mt-1.5 leading-relaxed">
                            <span className="font-semibold text-amber-300">Signed up with Google?</span> If you originally registered with Google, your account has no email password set yet. Click <button type="button" onClick={handleGoogleSignIn} className="underline text-white font-semibold hover:text-cyan-300">Sign in with Google</button> or click <button type="button" onClick={() => { setModalTab('reset'); setResetEmail(identifier); setShowResetModal(true); }} className="underline text-white font-semibold hover:text-cyan-300">Reset password</button> to create an email password.
                          </p>
                        )}
                        {errorCategory === 'pending' && (
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => navigate('/auth/callback')}
                              className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded-lg text-xs font-bold transition-colors"
                            >
                              Check Approval Status →
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className={`pt-2.5 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
                      errorCategory === 'unconfirmed' || errorCategory === 'pending' || errorCategory === 'unassigned'
                        ? 'border-amber-500/20'
                        : 'border-[#E53935]/20'
                    }`}>
                      <button
                        type="button"
                        onClick={() => {
                          setModalTab('reset');
                          setResetEmail(identifier);
                          setModalError('');
                          setModalSuccess('');
                          setShowResetModal(true);
                        }}
                        className="font-bold text-white/90 hover:text-white underline text-left transition-colors"
                      >
                        Reset password →
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (identifier.trim()) {
                            handleResendConfirmation(identifier);
                          } else {
                            setModalTab('resend');
                            setResetEmail('');
                            setModalError('');
                            setModalSuccess('');
                            setShowResetModal(true);
                          }
                        }}
                        disabled={isActionLoading || resendCooldown > 0}
                        className={`font-bold underline text-left transition-colors disabled:opacity-50 disabled:no-underline ${
                          isUnconfirmed || errorCategory === 'unconfirmed'
                            ? 'text-amber-300 hover:text-amber-200'
                            : 'text-white/90 hover:text-white'
                        }`}
                      >
                        {resendCooldown > 0 ? `Resend email in ${resendCooldown}s` : 'Resend confirmation email →'}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.3, ease: 'easeOut' }}
                className="group"
              >
                <label className="block text-[10px] font-bold text-[#A7ADB5] uppercase tracking-widest mb-2 transition-colors group-focus-within:text-white">
                  Operator ID / Email
                </label>
                <input
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={ROLE_PLACEHOLDERS[selectedRole]}
                  value={identifier}
                  onChange={e => { setIdentifier(e.target.value); setError(''); }}
                  disabled={isLoading}
                  className="aero-input disabled:opacity-50 focus:border-[#E53935] focus:ring-1 focus:ring-[#E53935]/30 focus:shadow-[0_0_15px_rgba(229,57,53,0.15)] transition duration-200"
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.3, ease: 'easeOut' }}
                className="group"
              >
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[10px] font-bold text-[#A7ADB5] uppercase tracking-widest transition-colors group-focus-within:text-white">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setModalTab('reset');
                      setResetEmail(identifier);
                      setModalError('');
                      setModalSuccess('');
                      setShowResetModal(true);
                    }}
                    className="text-[10px] font-semibold text-[#A7ADB5] hover:text-[#E53935] transition-colors"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Enter password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    disabled={isLoading}
                    className="aero-input pr-16 disabled:opacity-50 focus:border-[#E53935] focus:ring-1 focus:ring-[#E53935]/30 focus:shadow-[0_0_15px_rgba(229,57,53,0.15)] transition duration-200"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-[#A7ADB5] hover:text-white transition-colors uppercase tracking-widest px-1"
                  >
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={showPassword ? 'hide' : 'show'}
                        initial={{ opacity: 0, y: 2 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -2 }}
                        transition={{ duration: 0.15 }}
                        className="block"
                      >
                        {showPassword ? 'HIDE' : 'SHOW'}
                      </motion.span>
                    </AnimatePresence>
                  </button>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.3, ease: 'easeOut' }}
              >
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3.5 mt-2 rounded-xl text-sm font-black tracking-widest uppercase transition duration-200 bg-[#E53935] text-white hover:bg-[#ef5350] hover:-translate-y-[1px] hover:shadow-[0_6px_20px_rgba(229,57,53,0.3)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:transform-none"
                >
                  <AnimatePresence mode="wait">
                    {isLoading ? (
                      <motion.span
                        key="loading"
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="flex items-center justify-center gap-2"
                      >
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        AUTHENTICATING...
                      </motion.span>
                    ) : (
                      <motion.span
                        key="default"
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="block"
                      >
                        Sign In to AERO
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>

                {/* ── OR DIVIDER ── */}
                <div className="relative my-4 flex items-center justify-center">
                  <div className="border-t border-white/10 w-full" />
                  <span className="bg-aero-surface px-3 text-[10px] font-bold tracking-widest text-[#A7ADB5] uppercase shrink-0">
                    Or continue with
                  </span>
                  <div className="border-t border-white/10 w-full" />
                </div>

                {/* ── GOOGLE SIGN-IN BUTTON ── */}
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isLoading || isGoogleLoading}
                  className="w-full py-3.5 rounded-xl border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/30 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:-translate-y-[1px] active:scale-[0.98]"
                >
                  {isGoogleLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4 text-white" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Connecting to Google...
                    </span>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                      </svg>
                      <span>Sign In with Google</span>
                    </>
                  )}
                </button>
              </motion.div>
            </form>

            {/* Password Recovery & Confirmation Resend Modal */}
            <AnimatePresence>
              {showResetModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="w-full max-w-md bg-[#0F172A] border border-white/10 rounded-2xl p-6 shadow-2xl relative"
                  >
                    <button
                      type="button"
                      onClick={() => { setShowResetModal(false); setModalSuccess(''); setModalError(''); }}
                      className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>

                    {/* Tab Navigation */}
                    <div className="flex border-b border-white/10 mb-5 pb-1 gap-6">
                      <button
                        type="button"
                        onClick={() => { setModalTab('reset'); setModalError(''); setModalSuccess(''); }}
                        className={`pb-2 text-xs font-bold uppercase tracking-wider transition-colors relative ${
                          modalTab === 'reset'
                            ? 'text-white border-b-2 border-[#E53935]'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Reset Password
                      </button>
                      <button
                        type="button"
                        onClick={() => { setModalTab('resend'); setModalError(''); setModalSuccess(''); }}
                        className={`pb-2 text-xs font-bold uppercase tracking-wider transition-colors relative ${
                          modalTab === 'resend'
                            ? 'text-white border-b-2 border-[#E53935]'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Resend Confirmation
                      </button>
                    </div>

                    <h3 className="text-base font-bold text-white mb-1">
                      {modalTab === 'reset' ? 'Account Password Recovery' : 'Resend Email Confirmation'}
                    </h3>
                    <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                      {modalTab === 'reset'
                        ? 'Enter your operator email address. We will send you a secure link to reset your password.'
                        : 'Enter your registered email address to receive a fresh verification link.'}
                    </p>

                    {modalError && (
                      <div className="bg-[#E53935]/15 border border-[#E53935]/30 rounded-xl p-3 text-xs text-[#E53935] font-medium mb-4 flex items-start gap-2">
                        <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <span>{modalError}</span>
                      </div>
                    )}

                    {modalSuccess ? (
                      <div className="bg-[#12B981]/15 border border-[#12B981]/30 rounded-xl p-4 text-xs text-[#12B981] mb-4 space-y-1.5">
                        <div className="flex items-center gap-2 font-bold">
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                          <span>Email Dispatched Successfully</span>
                        </div>
                        <p className="text-slate-300">{modalSuccess}</p>
                      </div>
                    ) : (
                      <form
                        onSubmit={modalTab === 'reset' ? handleSendPasswordReset : (e) => { e.preventDefault(); handleResendConfirmation(resetEmail); }}
                        className="space-y-4"
                      >
                        <div>
                          <label className="block text-[10px] font-bold text-[#A7ADB5] uppercase tracking-widest mb-1.5">
                            Account Email
                          </label>
                          <input
                            type="email"
                            required
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            placeholder="operator@agency.org"
                            value={resetEmail}
                            onChange={e => { setResetEmail(e.target.value); setModalError(''); }}
                            disabled={isActionLoading}
                            className="aero-input w-full text-sm"
                          />
                        </div>

                        {modalTab === 'reset' ? (
                          <button
                            type="submit"
                            disabled={isActionLoading || resetCooldown > 0}
                            className="w-full py-2.5 rounded-xl bg-[#E53935] hover:bg-[#ef5350] text-white text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                          >
                            {isActionLoading
                              ? 'SENDING RECOVERY EMAIL...'
                              : resetCooldown > 0
                              ? `WAIT ${resetCooldown}S TO RETRY`
                              : 'SEND RECOVERY EMAIL'}
                          </button>
                        ) : (
                          <button
                            type="submit"
                            disabled={isActionLoading || resendCooldown > 0}
                            className="w-full py-2.5 rounded-xl bg-[#E53935] hover:bg-[#ef5350] text-white text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                          >
                            {isActionLoading
                              ? 'SENDING CONFIRMATION EMAIL...'
                              : resendCooldown > 0
                              ? `WAIT ${resendCooldown}S TO RETRY`
                              : 'RESEND CONFIRMATION EMAIL'}
                          </button>
                        )}
                      </form>
                    )}

                    <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">
                        {modalTab === 'reset'
                          ? (resetCooldown > 0 ? `Cooldown: ${resetCooldown}s remaining` : 'Rate limit: 1 email / min')
                          : (resendCooldown > 0 ? `Cooldown: ${resendCooldown}s remaining` : 'Rate limit: 1 email / min')}
                      </span>
                      <button
                        type="button"
                        onClick={() => { setShowResetModal(false); setModalSuccess(''); setModalError(''); }}
                        className="text-xs text-slate-400 hover:text-white font-medium transition-colors"
                      >
                        Back to Sign In
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.3, ease: 'easeOut' }}
              className="mt-6 flex items-center justify-center gap-2 text-sm text-[#A7ADB5] font-medium"
            >
              <span>No account?</span>
              <button onClick={() => navigate('/register')} className="font-bold text-[#E53935] hover:text-[#ef5350] transition-colors">
                Request Access
              </button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35, duration: 0.3 }}
              className="mt-6 pt-6 border-t border-aero-border"
            >
              <p className="text-center text-[11px] font-medium text-[#A7ADB5]/60 leading-relaxed">
                For authorized AERO operators only.
              </p>
            </motion.div>
          </div>
          </div>
      </div>
    </motion.div>
  );
}
