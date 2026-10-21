import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Drawer } from '../../../components/ui/Drawer';
import { EmergencyProtocolContent, TermsOfServiceContent } from '../../public/components/LegalContent';
import { supabase } from '../../../lib/supabase';
import { validateEmailAddress } from '../../../utils/emailValidation';
import { getRemainingCooldown, setCooldown } from '../../../utils/authCooldown';
import { hospitalService } from '../../../services/hospitalService';
import { geolocationService } from '../../../services/geolocationService';
import { discoverHospitals } from '../../../services/hospitalSearch';
import { searchTomTomHospitals } from '../../../services/hospitalSearch/tomtomProvider';
import type { Hospital } from '../../../types';
import type { NormalizedHospital } from '../../../services/hospitalSearch/types';

interface RegisterPageProps {
  onRegister: (role: string) => void;
}

export function RegisterPage({ onRegister }: RegisterPageProps) {
  const navigate = useNavigate();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'AMBULANCE',
    badgeNumber: '',
    vehicleNumber: '',
    hospitalId: '',
  });
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isRegistrationComplete, setIsRegistrationComplete] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [resendCooldown, setResendCooldown] = useState(() => getRemainingCooldown('resend_confirmation'));
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [mapHospitals, setMapHospitals] = useState<NormalizedHospital[]>([]);
  const [searchRadius, setSearchRadius] = useState(5000);
  const [_isSearchingRadius, setIsSearchingRadius] = useState(false);
  
  // Drawer state
  const [legalDrawerOpen, setLegalDrawerOpen] = useState(false);
  const [legalDrawerType, setLegalDrawerType] = useState<'protocol' | 'terms'>('protocol');

  // Live countdown timer for resend cooldown
  useEffect(() => {
    const timer = setInterval(() => {
      setResendCooldown(getRemainingCooldown('resend_confirmation'));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleResendFromRegister = async () => {
    if (!registeredEmail) return;
    const remaining = getRemainingCooldown('resend_confirmation');
    if (remaining > 0) {
      setResendError(`Please wait ${remaining}s before requesting another confirmation email.`);
      return;
    }
    setIsResending(true);
    setResendMessage(null);
    setResendError(null);
    try {
      const redirectUrl = `${window.location.origin}/auth/callback`;
      const { error: resendErr } = await supabase.auth.resend({
        type: 'signup',
        email: registeredEmail,
        options: {
          emailRedirectTo: redirectUrl,
        }
      });
      if (resendErr) {
        if (resendErr.message?.toLowerCase().includes('rate limit')) {
          setResendError('Email rate limit reached. Please wait a moment before requesting another confirmation email.');
        } else {
          setResendError(resendErr.message || 'Failed to resend confirmation email.');
        }
      } else {
        setCooldown('resend_confirmation', 60);
        setResendCooldown(60);
        setResendMessage(`Confirmation email resent to ${registeredEmail}! Please check your inbox and spam folder.`);
      }
    } catch (err: any) {
      setResendError(err.message || 'Error sending confirmation email.');
    } finally {
      setIsResending(false);
    }
  };

  // Combobox & Search state
  const [hospitalSearchTerm, setHospitalSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<NormalizedHospital[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [selectedHospitalObj, setSelectedHospitalObj] = useState<NormalizedHospital | Hospital | null>(null);

  const [userLocation, setUserLocation] = useState<[number, number]>([17.44, 78.34]);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search for hospital facilities (Apollo, KIMS, Yashoda, CARE, etc.)
  useEffect(() => {
    const trimmed = hospitalSearchTerm.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError('');
      setSelectedIndex(-1);
      return;
    }

    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setSearchLoading(true);
    setSearchError('');
    setSelectedIndex(-1);

    const handler = setTimeout(async () => {
      try {
        const results = await searchTomTomHospitals(
          userLocation[0],
          userLocation[1],
          searchRadius,
          controller.signal,
          trimmed
        );
        if (!controller.signal.aborted) {
          setSearchResults(results);
          setSearchLoading(false);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('[RegisterPage] Hospital search error:', err);
          setSearchError('Search failed. Please try again.');
          setSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(handler);
    };
  }, [hospitalSearchTerm, userLocation, searchRadius]);

  const loadMapHospitals = (lat: number, lng: number, radiusMeters: number) => {
    setIsSearchingRadius(true);
    discoverHospitals(lat, lng, radiusMeters, false)
      .then(data => {
        setMapHospitals(data.results);
        
        // Auto-select first only if nothing is currently selected
        setFormData(prev => {
          if (!prev.hospitalId && data.results.length > 0) {
            setSelectedHospitalObj(data.results[0]);
            return { ...prev, hospitalId: data.results[0].id };
          }
          return prev;
        });
      })
      .catch(console.error)
      .finally(() => setIsSearchingRadius(false));
  };

  useEffect(() => {
    // Attempt to load from map API if geolocation is available
    geolocationService.getCurrentPosition()
      .then(pos => {
        setUserLocation([pos.latitude, pos.longitude]);
      })
      .catch(() => {
        // Fallback to a default location (Hyderabad) if geolocation is denied/fails
        setUserLocation([17.44, 78.34]);
      });

    // Also load local DB hospitals
    hospitalService.getAllHospitals().then(data => {
      setHospitals(data);
      if (data.length > 0 && !formData.hospitalId) {
        setSelectedHospitalObj(data[0]);
        setFormData(prev => ({ ...prev, hospitalId: data[0].id }));
      }
    });
  }, []);

  // Fetch nearby hospitals whenever location or radius changes
  useEffect(() => {
    loadMapHospitals(userLocation[0], userLocation[1], searchRadius);
  }, [userLocation, searchRadius]);

  const calculatePasswordStrength = (pass: string) => {
    if (pass.length === 0) return 0;
    if (pass.length < 6) return 25;
    let strength = 25;
    if (/[A-Z]/.test(pass)) strength += 25;
    if (/[0-9]/.test(pass)) strength += 25;
    if (/[^A-Za-z0-9]/.test(pass)) strength += 25;
    return Math.min(100, strength);
  };

  const strength = calculatePasswordStrength(formData.password || '');

  const activeHospitals = useMemo(() => {
    const combinedMap = new Map<string, typeof hospitals[0] | NormalizedHospital>();
    
    // Add Map hospitals first so they retain their distanceMeters for correct sorting
    mapHospitals.forEach(h => {
      combinedMap.set(h.name.toLowerCase().trim(), h as any);
    });

    // Add DB hospitals (keeping map hospitals if they are similar)
    hospitals.forEach(h => {
      const key = h.name.toLowerCase().trim();
      if (!combinedMap.has(key)) {
        combinedMap.set(key, h);
      }
    });
    
    const combined = Array.from(combinedMap.values());
    
    return combined.sort((a, b) => {
      const distA = 'distanceMeters' in a ? (a as NormalizedHospital).distanceMeters : 999999;
      const distB = 'distanceMeters' in b ? (b as NormalizedHospital).distanceMeters : 999999;
      return distA - distB;
    });
  }, [hospitals, mapHospitals]);

  const isQuerySearch = hospitalSearchTerm.trim().length >= 2;
  const displayedHospitals: NormalizedHospital[] = isQuerySearch
    ? searchResults
    : (activeHospitals as NormalizedHospital[]);

  const selectedHospitalName = useMemo(() => {
    if (selectedHospitalObj?.name) return selectedHospitalObj.name;
    const found = activeHospitals.find(h => h.id === formData.hospitalId) || searchResults.find(h => h.id === formData.hospitalId);
    return found?.name || '';
  }, [selectedHospitalObj, activeHospitals, searchResults, formData.hospitalId]);

  const handleSelectHospital = (h: NormalizedHospital | Hospital) => {
    setSelectedHospitalObj(h);
    setFormData(prev => ({ ...prev, hospitalId: h.id }));
    setHospitalSearchTerm('');
    setIsDropdownOpen(false);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsDropdownOpen(true);
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < displayedHospitals.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : displayedHospitals.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < displayedHospitals.length) {
        handleSelectHospital(displayedHospitals[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsDropdownOpen(false);
      setSelectedIndex(-1);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    
    try {
      let finalHospitalId = formData.hospitalId;

      // If user selected a map-based hospital (id is not a UUID)
      const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(finalHospitalId);
      if (!isUuid && ['HOSPITAL', 'AMBULANCE'].includes(formData.role) && finalHospitalId) {
        const selectedMapHosp = (selectedHospitalObj as NormalizedHospital) ||
          mapHospitals.find(h => h.id === finalHospitalId) ||
          searchResults.find(h => h.id === finalHospitalId);

        if (selectedMapHosp) {
          const { data, error: rpcError } = await supabase.rpc('get_or_create_hospital', {
            p_name: selectedMapHosp.name,
            p_address: selectedMapHosp.address || '',
            p_lat: selectedMapHosp.lat,
            p_lng: selectedMapHosp.lng,
            p_phone: selectedMapHosp.phone || ''
          });
          
          if (rpcError) throw rpcError;
          if (data) finalHospitalId = data;
        }
      }

      const rawEmail = formData.email.trim().toLowerCase();
      const emailValidation = validateEmailAddress(rawEmail);
      if (!emailValidation.isValid) {
        setError(emailValidation.error || 'Please enter a valid official email address.');
        setIsLoading(false);
        return;
      }

      const cleanEmail = emailValidation.normalizedEmail;
      const cleanFullName = formData.fullName.trim();
      const redirectUrl = `${window.location.origin}/auth/callback`;

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password: formData.password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: cleanFullName,
            role: formData.role.toLowerCase(),
            badge_number: formData.badgeNumber?.trim() || null,
            vehicle_number: formData.vehicleNumber?.trim() || null,
            hospital_id: finalHospitalId || null,
          },
        },
      });

      if (signUpError) throw signUpError;

      // Check if session was returned immediately (email confirmation disabled or auto-confirmed)
      if (!signUpData?.session) {
        setIsRegistrationComplete(true);
        setRegisteredEmail(cleanEmail);
        return;
      }

      // If session exists, persist profile row in public.profiles
      if (signUpData.user?.id) {
        try {
          await supabase.from('profiles').upsert({
            id: signUpData.user.id,
            role: formData.role.toLowerCase(),
            full_name: cleanFullName,
            status: 'ACTIVE'
          }, { onConflict: 'id' });
        } catch (profErr) {
          console.warn('[Register] Profile auto-creation warning:', profErr);
        }
      }

      onRegister(formData.role);
    } catch (err: any) {
      console.error('Registration error:', err);
      setError(err.message || 'Failed to create account');
    } finally {
      setIsLoading(false);
    }
  };

  const strengthColor = strength < 50 ? '#EF3B3A' : strength < 75 ? '#FFB020' : '#12B981';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="min-h-screen flex bg-aero-background font-sans" style={{ colorScheme: 'dark' }}
    >

      {/* ── LEFT: Cinematic image panel ── */}
      <div className="hidden lg:flex flex-col w-[480px] shrink-0 relative overflow-hidden">
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
            src="/hospital_arrival.jpg"
            alt="Ambulance arriving at emergency hospital"
            className="w-full h-full object-cover object-center"
          />
        </motion.div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#07090C] via-[#07090C]/75 to-[#07090C]/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#07090C]/30" />

        <div className="relative z-10 flex flex-col h-full p-12">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="flex items-center gap-3"
          >
            <div className="w-10 h-10 rounded-xl bg-[#EF3B3A] flex items-center justify-center shadow-[0_0_20px_rgba(229,57,53,0.4)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z" fill="white" opacity="0.95"/>
                <path d="M9 12h6M12 9v6" stroke="#07090C" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <p className="text-aero-text-primary font-black text-xl leading-none tracking-tight">AERO</p>
              <p className="text-aero-text-primary/50 font-bold text-[9px] uppercase tracking-[0.2em] mt-0.5">Emergency Response Network</p>
            </div>
          </motion.div>

          <div className="mt-auto">
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="text-aero-text-primary/60 text-xs font-bold uppercase tracking-widest mb-4"
            >
              Operator Onboarding
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="text-3xl font-black text-aero-text-primary leading-tight mb-4"
            >
              Join the<br/>response network.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="text-aero-text-primary/60 text-sm font-medium leading-relaxed max-w-xs"
            >
              Register as an ambulance operator, traffic authority, hospital staff, or command center administrator.
            </motion.p>

            {/* Role indicators */}
            <div className="mt-8 grid grid-cols-2 gap-2">
              {[
                { label: 'Ambulance Units', color: '#EF3B3A' },
                { label: 'Traffic Police', color: '#FFB020' },
                { label: 'Hospital ER', color: '#12B981' },
                { label: 'Command Center', color: '#1687D9' },
              ].map((item, i) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + (i * 0.1), duration: 0.5 }}
                  className="flex items-center gap-2 border border-white/10 rounded-lg px-3 py-2 bg-white/5 backdrop-blur-sm"
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-aero-text-primary/70 text-[10px] font-bold uppercase tracking-wider">{item.label}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT: Registration panel ── */}
      <div className="flex-1 flex flex-col justify-center px-6 py-10 lg:px-12 bg-aero-surface relative overflow-y-auto">
        {/* Subtle grid texture */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }} />

        <div className="relative z-10 sm:mx-auto sm:w-full sm:max-w-md py-6">
          {/* Mobile Logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-[#EF3B3A] flex items-center justify-center shadow-[0_0_16px_rgba(229,57,53,0.4)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z" fill="white"/>
                <path d="M9 12h6M12 9v6" stroke="#07090C" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-aero-text-primary font-black text-xl tracking-tight">AERO</span>
          </div>

          <div className="relative">
            {isRegistrationComplete ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#0B1528] border border-white/10 rounded-2xl p-8 text-center shadow-2xl"
              >
                <div className="w-16 h-16 rounded-2xl bg-[#12B981]/20 border border-[#12B981]/40 mx-auto flex items-center justify-center mb-5 text-[#12B981]">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                </div>
                <span className="text-[10px] font-mono font-bold tracking-widest text-[#12B981] uppercase px-3 py-1 rounded-full bg-[#12B981]/10 border border-[#12B981]/30 inline-block mb-3">
                  Account Registered
                </span>
                <h2 className="text-2xl font-black text-white tracking-tight mb-3">Check Your Email</h2>
                <p className="text-xs text-slate-300 mb-6 leading-relaxed">
                  We've sent a verification link to <strong className="text-white">{registeredEmail}</strong>.<br />
                  Please confirm your email address to activate your AERO operator access, then sign in.
                </p>

                {resendMessage && (
                  <div className="mb-4 bg-[#12B981]/15 border border-[#12B981]/30 rounded-xl p-3 text-xs text-[#12B981] font-medium text-left">
                    {resendMessage}
                  </div>
                )}

                {resendError && (
                  <div className="mb-4 bg-[#E53935]/15 border border-[#E53935]/30 rounded-xl p-3 text-xs text-[#E53935] font-medium text-left">
                    {resendError}
                  </div>
                )}

                <div className="space-y-3 pt-2">
                  <button
                    type="button"
                    onClick={() => navigate('/login')}
                    className="w-full py-3.5 rounded-xl text-xs font-black tracking-widest uppercase bg-[#E53935] hover:bg-[#ef5350] text-white transition-all shadow-[0_4px_16px_rgba(229,57,53,0.35)]"
                  >
                    PROCEED TO SIGN IN
                  </button>
                  <button
                    type="button"
                    onClick={handleResendFromRegister}
                    disabled={isResending || resendCooldown > 0}
                    className="w-full py-2.5 rounded-xl text-xs font-bold text-slate-300 hover:text-white border border-white/10 hover:border-white/20 bg-white/5 transition-all disabled:opacity-50"
                  >
                    {isResending ? 'SENDING CONFIRMATION...' : resendCooldown > 0 ? `RESEND EMAIL IN ${resendCooldown}S` : 'RESEND CONFIRMATION EMAIL'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsRegistrationComplete(false);
                      setResendMessage(null);
                      setResendError(null);
                    }}
                    className="w-full py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition-colors"
                  >
                    Register another account
                  </button>
                </div>
              </motion.div>
            ) : (
              <>
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05, duration: 0.3, ease: 'easeOut' }}
                  className="mb-7"
                >
                  <p className="text-aero-text-secondary text-xs font-bold uppercase tracking-widest mb-2 transition-colors focus-within:text-aero-text-primary">New Operator</p>
                  <h1 className="text-2xl font-black text-aero-text-primary tracking-tight">Create Account</h1>
                </motion.div>

                <AnimatePresence mode="wait">
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-5 flex items-center gap-3 bg-[#EF3B3A]/10 border border-[#EF3B3A]/20 rounded-xl px-4 py-3 text-sm text-[#EF3B3A] font-medium overflow-hidden"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      <span>{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {/* Full Name */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.3, ease: 'easeOut' }}
                className="group"
              >
                <label className="block text-[10px] font-bold text-aero-text-secondary uppercase tracking-widest mb-2 transition-colors group-focus-within:text-aero-text-primary">Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Vikram Joshi / Officer Sharma"
                  value={formData.fullName}
                  onChange={(e) => setFormData({...formData, fullName: e.target.value})}
                  required
                  className="aero-input focus:border-[#EF3B3A] focus:ring-1 focus:ring-[#EF3B3A]/30 focus:shadow-[0_0_15px_rgba(229,57,53,0.15)] transition duration-200"
                />
              </motion.div>

              {/* Email */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.3, ease: 'easeOut' }}
                className="group"
              >
                <label className="block text-[10px] font-bold text-aero-text-secondary uppercase tracking-widest mb-2 transition-colors group-focus-within:text-aero-text-primary">Official Email</label>
                <input
                  type="email"
                  placeholder="operator@agency.org"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  className="aero-input focus:border-[#EF3B3A] focus:ring-1 focus:ring-[#EF3B3A]/30 focus:shadow-[0_0_15px_rgba(229,57,53,0.15)] transition duration-200"
                />
              </motion.div>

              {/* Operational Role */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.3, ease: 'easeOut' }}
                className="group"
              >
                <label className="block text-[10px] font-bold text-aero-text-secondary uppercase tracking-widest mb-2 transition-colors group-focus-within:text-aero-text-primary">Operational Role</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({...formData, role: e.target.value})}
                  className="aero-input appearance-none cursor-pointer focus:border-[#EF3B3A] focus:ring-1 focus:ring-[#EF3B3A]/30 focus:shadow-[0_0_15px_rgba(229,57,53,0.15)] transition duration-200"
                >
                  <option value="AMBULANCE">Ambulance Operator / Paramedic</option>
                  <option value="POLICE">Traffic Police Command Officer</option>
                  <option value="HOSPITAL">Hospital ER & Trauma Staff</option>
                  <option value="ADMIN">Central Operations Administrator</option>
                </select>
              </motion.div>

              {/* Role Specific Fields */}
              <AnimatePresence mode="popLayout">
                {formData.role === 'AMBULANCE' && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }} className="group">
                    <label className="block text-[10px] font-bold text-aero-text-secondary uppercase tracking-widest mb-2 transition-colors group-focus-within:text-aero-text-primary">Vehicle Registration Number</label>
                    <input
                      type="text"
                      placeholder="e.g. KA-01-EA-1008"
                      value={formData.vehicleNumber || ''}
                      onChange={(e) => setFormData({...formData, vehicleNumber: e.target.value})}
                      required
                      className="aero-input focus:border-[#EF3B3A] focus:ring-1 focus:ring-[#EF3B3A]/30 focus:shadow-[0_0_15px_rgba(229,57,53,0.15)] transition duration-200"
                    />
                  </motion.div>
                )}

                {formData.role === 'POLICE' && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }} className="group">
                    <label className="block text-[10px] font-bold text-aero-text-secondary uppercase tracking-widest mb-2 transition-colors group-focus-within:text-aero-text-primary">Police Badge Number</label>
                    <input
                      type="text"
                      placeholder="e.g. B-4091"
                      value={formData.badgeNumber || ''}
                      onChange={(e) => setFormData({...formData, badgeNumber: e.target.value})}
                      required
                      className="aero-input focus:border-[#EF3B3A] focus:ring-1 focus:ring-[#EF3B3A]/30 focus:shadow-[0_0_15px_rgba(229,57,53,0.15)] transition duration-200"
                    />
                  </motion.div>
                )}

                {['HOSPITAL', 'AMBULANCE'].includes(formData.role) && (
                  <motion.div
                    ref={containerRef}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3 }}
                    className="group relative z-20"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <label htmlFor="hospital-search-input" className="block text-[10px] font-bold text-aero-text-secondary uppercase tracking-widest transition-colors group-focus-within:text-aero-text-primary">
                        Assigned Hospital Facility
                      </label>
                      <div className="flex gap-1" role="group" aria-label="Search Radius Filter">
                        {[5, 15, 25, 50].map(r => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setSearchRadius(r * 1000)}
                            className={`px-2 py-0.5 text-[9px] font-bold rounded transition-colors ${
                              searchRadius === r * 1000 
                                ? 'bg-[#EF3B3A] text-aero-text-primary shadow-[0_0_10px_rgba(239,59,58,0.3)]' 
                                : 'bg-[#1A1D24] text-aero-text-secondary hover:text-aero-text-primary border border-aero-border'
                            }`}
                          >
                            {r}km
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Search Input Container */}
                    <div className="relative">
                      <div className="relative flex items-center">
                        <input
                          id="hospital-search-input"
                          ref={searchInputRef}
                          type="text"
                          autoComplete="off"
                          placeholder={formData.hospitalId ? (selectedHospitalName || 'Search hospital name...') : 'Type hospital (e.g. Apollo, KIMS, Yashoda, CARE)...'}
                          value={hospitalSearchTerm}
                          onChange={(e) => {
                            setHospitalSearchTerm(e.target.value);
                            setIsDropdownOpen(true);
                          }}
                          onFocus={() => {
                            setIsDropdownOpen(true);
                          }}
                          onKeyDown={handleKeyDown}
                          className="aero-input pr-16 focus:border-[#EF3B3A] focus:ring-1 focus:ring-[#EF3B3A]/30 focus:shadow-[0_0_15px_rgba(229,57,53,0.15)] transition duration-200"
                        />
                        {/* Clear and Status Action Buttons */}
                        <div className="absolute right-2.5 flex items-center gap-1.5">
                          {hospitalSearchTerm && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setHospitalSearchTerm('');
                                setSearchResults([]);
                                searchInputRef.current?.focus();
                              }}
                              aria-label="Clear search"
                              className="w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 text-aero-text-secondary hover:text-white flex items-center justify-center text-xs transition"
                            >
                              ✕
                            </button>
                          )}
                          {searchLoading && (
                            <div className="w-4 h-4 rounded-full border-2 border-[#EF3B3A] border-t-transparent animate-spin" />
                          )}
                        </div>
                      </div>

                      {/* Dropdown Menu */}
                      <AnimatePresence>
                        {isDropdownOpen && (
                          <motion.div 
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 5 }}
                            className="absolute z-[100] w-full mt-2 max-h-64 overflow-y-auto bg-[#0E121A] border border-slate-700/80 rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.8)] custom-scrollbar"
                          >
                            {/* Loading State */}
                            {searchLoading && (
                              <div className="p-4 text-xs text-slate-400 text-center flex items-center justify-center gap-2">
                                <div className="w-3.5 h-3.5 rounded-full border-2 border-[#EF3B3A] border-t-transparent animate-spin" />
                                Searching verified hospitals...
                              </div>
                            )}

                            {/* Error State */}
                            {!searchLoading && searchError && (
                              <div className="p-4 text-xs text-rose-400 text-center flex flex-col items-center gap-2">
                                <span>{searchError}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSearchError('');
                                    setSearchRadius(prev => prev);
                                  }}
                                  className="text-[10px] font-bold uppercase text-[#EF3B3A] hover:underline"
                                >
                                  Retry Search
                                </button>
                              </div>
                            )}

                            {/* Empty Results State */}
                            {!searchLoading && !searchError && displayedHospitals.length === 0 && (
                              <div className="p-4 text-xs text-slate-400 text-center">
                                {isQuerySearch ? (
                                  <>
                                    <p className="font-semibold text-slate-300">No hospitals found matching "{hospitalSearchTerm}"</p>
                                    <p className="text-[10px] text-slate-500 mt-1">Try expanding radius to 25km or 50km or check spelling</p>
                                  </>
                                ) : (
                                  <>
                                    <p className="font-semibold text-slate-300">No verified hospitals found within {searchRadius / 1000}km</p>
                                    <p className="text-[10px] text-slate-500 mt-1">Increase radius above or type hospital name directly</p>
                                  </>
                                )}
                              </div>
                            )}

                            {/* Hospital Items List */}
                            {!searchLoading && !searchError && displayedHospitals.map((h, idx) => {
                              const isSelected = h.id === formData.hospitalId;
                              const isKeyboardFocused = idx === selectedIndex;
                              const isOutside = (h as any).isOutsideRadius || (('distanceMeters' in h) && (h as any).distanceMeters > searchRadius);

                              return (
                                <div
                                  key={h.id || idx}
                                  role="option"
                                  aria-selected={isSelected}
                                  onPointerDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleSelectHospital(h);
                                  }}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleSelectHospital(h);
                                  }}
                                  className={`p-3 cursor-pointer border-b border-slate-800/80 last:border-0 transition-colors flex justify-between items-start gap-3 ${
                                    isKeyboardFocused ? 'bg-white/10' : (isSelected ? 'bg-[#EF3B3A]/10 border-l-2 border-l-[#EF3B3A]' : 'hover:bg-white/5')
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <h4 className="text-sm font-bold text-white truncate">{h.name}</h4>
                                      {isSelected && (
                                        <span className="text-[9px] bg-[#EF3B3A] text-white px-1.5 py-0.2 rounded font-black tracking-wider">
                                          SELECTED
                                        </span>
                                      )}
                                    </div>
                                    {h.address && (
                                      <p className="text-[11px] text-slate-400 mt-0.5 truncate">{h.address}</p>
                                    )}
                                  </div>

                                  <div className="shrink-0 text-right">
                                    {isOutside ? (
                                      <span className="text-[9px] font-bold text-amber-400 bg-amber-950/40 border border-amber-600/40 px-2 py-0.5 rounded-full block">
                                        Outside {searchRadius / 1000}km ({(('distanceMeters' in h) ? (h as any).distanceMeters / 1000 : 0).toFixed(1)} km)
                                      </span>
                                    ) : (
                                      ('distanceMeters' in h) && (
                                        <span className="text-[10px] font-bold text-[#12B981] bg-[#12B981]/10 px-2 py-0.5 rounded-full block">
                                          {((h as any).distanceMeters / 1000).toFixed(1)} km
                                        </span>
                                      )
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Selected Facility Card */}
                    {formData.hospitalId && selectedHospitalName && (
                      <div className="mt-2.5 p-3 rounded-xl bg-[#0D111A] border border-emerald-500/30 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                            🏥
                          </div>
                          <div className="min-w-0">
                            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest block">Selected Facility</span>
                            <h4 className="text-xs font-bold text-white truncate">{selectedHospitalName}</h4>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setIsDropdownOpen(true);
                            searchInputRef.current?.focus();
                          }}
                          className="text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-wider px-2 py-1 rounded bg-white/5 hover:bg-white/10 transition"
                        >
                          Change
                        </button>
                      </div>
                    )}

                    {mapHospitals.length > 0 && (
                      <p className="text-[10px] text-[#12B981] mt-1.5 font-bold">📡 Loaded from Live Verified Facility Network</p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Passwords */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.3, ease: 'easeOut' }}
                className="grid grid-cols-1 sm:grid-cols-2 gap-4"
              >
                <div className="group">
                  <label className="block text-[10px] font-bold text-aero-text-secondary uppercase tracking-widest mb-2 transition-colors group-focus-within:text-aero-text-primary">Create Password</label>
                  <input
                    type="password"
                    placeholder="Min 6 characters"
                    value={formData.password}
                    onChange={(e) => setFormData({...formData, password: e.target.value})}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    className="aero-input focus:border-[#EF3B3A] focus:ring-1 focus:ring-[#EF3B3A]/30 focus:shadow-[0_0_15px_rgba(229,57,53,0.15)] transition duration-200"
                  />
                  {/* Password strength */}
                  <div className="mt-2 flex gap-1 h-1">
                    {[25, 50, 75, 100].map(level => (
                      <div
                        key={level}
                        className="flex-1 rounded-full transition-all duration-300"
                        style={{ backgroundColor: strength >= level ? strengthColor : 'rgba(255,255,255,0.08)' }}
                      />
                    ))}
                  </div>
                </div>

                <div className="group">
                  <label className="block text-[10px] font-bold text-aero-text-secondary uppercase tracking-widest mb-2 transition-colors group-focus-within:text-aero-text-primary">Confirm Password</label>
                  <input
                    type="password"
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    className="aero-input focus:border-[#EF3B3A] focus:ring-1 focus:ring-[#EF3B3A]/30 focus:shadow-[0_0_15px_rgba(229,57,53,0.15)] transition duration-200"
                  />
                </div>
              </motion.div>

              {/* Terms */}
              <motion.label
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.3, ease: 'easeOut' }}
                className="flex items-start gap-3 mt-2 cursor-pointer group"
              >
                <div className="relative mt-0.5 flex items-center justify-center w-4 h-4 rounded border border-aero-border bg-aero-surface transition-colors group-hover:border-[#EF3B3A]/50 overflow-hidden shrink-0">
                  <input
                    type="checkbox"
                    required
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <AnimatePresence>
                    {agreed && (
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        className="absolute inset-0 bg-[#EF3B3A] flex items-center justify-center"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <span className="text-xs text-aero-text-secondary leading-relaxed group-hover:text-aero-text-primary transition-colors">
                  I agree to AERO's{' '}
                  <button type="button" onClick={(e) => { e.preventDefault(); setLegalDrawerType('protocol'); setLegalDrawerOpen(true); }} className="font-bold text-[#EF3B3A] hover:text-[#D92F2F]">emergency response protocol</button>
                  {' '}&{' '}
                  <button type="button" onClick={(e) => { e.preventDefault(); setLegalDrawerType('terms'); setLegalDrawerOpen(true); }} className="font-bold text-[#EF3B3A] hover:text-[#D92F2F]">terms of service</button>.
                </span>
              </motion.label>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, duration: 0.3, ease: 'easeOut' }}
              >
                <button
                  type="submit"
                  disabled={isLoading || !agreed}
                  className="w-full py-3.5 mt-2 rounded-xl text-sm font-black tracking-widest uppercase transition duration-200 bg-[#EF3B3A] text-aero-text-primary hover:bg-[#D92F2F] hover:-translate-y-[1px] hover:shadow-[0_6px_20px_rgba(229,57,53,0.3)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:transform-none"
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
                        CREATING OPERATOR...
                      </motion.span>
                    ) : (
                      <motion.span
                        key="default"
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="block"
                      >
                        Create Account & Verify Email
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              </motion.div>
            </form>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.3 }}
              className="mt-6 pt-6 border-t border-aero-border text-center"
            >
              <span className="text-sm text-aero-text-secondary font-medium">Already have an account? </span>
              <button onClick={() => navigate('/login')} className="font-bold text-[#EF3B3A] hover:text-[#D92F2F] transition-colors text-sm">
                Sign In
              </button>
            </motion.div>
          </>
        )}
      </div>
    </div>
  </div>

      {/* Legal Drawer */}
      <Drawer
        open={legalDrawerOpen}
        onClose={() => setLegalDrawerOpen(false)}
        position="right"
      >
        <div className="h-full flex flex-col bg-[#070A0F] text-[#F4F7FA]">
          {/* Drawer Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/[0.08]">
            <h2 className="text-xl font-bold tracking-tight text-aero-text-primary">
              {legalDrawerType === 'protocol' ? 'Emergency Protocol' : 'Terms of Service'}
            </h2>
            <button
              onClick={() => setLegalDrawerOpen(false)}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-aero-text-secondary hover:text-aero-text-primary transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          
          {/* Drawer Content */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <div className="prose prose-invert prose-red max-w-none text-sm text-aero-text-secondary space-y-6">
              {legalDrawerType === 'protocol' ? <EmergencyProtocolContent /> : <TermsOfServiceContent />}
            </div>
          </div>
          
          {/* Drawer Footer */}
          <div className="p-6 border-t border-white/[0.08] bg-[#0B0D10]">
            <button
              type="button"
              onClick={() => {
                setAgreed(true);
                setLegalDrawerOpen(false);
              }}
              className="w-full py-3 bg-[#EF3B3A] text-aero-text-primary rounded-lg font-bold text-sm hover:bg-[#D92F2F] transition-colors"
            >
              Accept & Continue
            </button>
          </div>
        </div>
      </Drawer>
    </motion.div>
  );
}

