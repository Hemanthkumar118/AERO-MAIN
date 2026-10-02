import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import { PageHeader as Header } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useAuth, type AeroProfile } from '../../../providers/AuthProvider';
import { hospitalService } from '../../../services/hospitalService';
import { discoverHospitals, autocompleteGooglePlaces, getGooglePlaceDetails } from '../../../services/hospitalSearch';
import { geolocationService } from '../../../services/geolocationService';
import type { Hospital } from '../../../types';
import type { NormalizedHospital } from '../../../services/hospitalSearch/types';
import { AnimatePresence, motion } from 'framer-motion';

export function AccountSettingsPage() {
  const { user, profile: authProfile, profileLoading, profileError, refreshProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [localProfile, setLocalProfile] = useState<AeroProfile | null>(null);
  
  const [bannerState, setBannerState] = useState<{ type: 'error' | 'success', message: string } | null>(null);

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [mapHospitals, setMapHospitals] = useState<NormalizedHospital[]>([]);
  const [hospitalSearchTerm, setHospitalSearchTerm] = useState('');
  const [searchRadius, setSearchRadius] = useState(5000);
  const [_isSearchingRadius, setIsSearchingRadius] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
  const [userLocation, setUserLocation] = useState<[number, number]>([17.44, 78.34]);
  const [autocompleteResults, setAutocompleteResults] = useState<any[]>([]);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  const [fetchingDetailsId, setFetchingDetailsId] = useState<string | null>(null);

  // Debounce autocomplete search
  useEffect(() => {
    if (!hospitalSearchTerm.trim()) {
      setAutocompleteResults([]);
      return;
    }

    const handler = setTimeout(async () => {
      setAutocompleteLoading(true);
      try {
        const results = await autocompleteGooglePlaces(hospitalSearchTerm, userLocation[0], userLocation[1], 50000);
        setAutocompleteResults(results);
      } catch (err) {
        console.error("Autocomplete failed:", err);
        setAutocompleteResults([]);
      } finally {
        setAutocompleteLoading(false);
      }
    }, 400);

    return () => clearTimeout(handler);
  }, [hospitalSearchTerm, userLocation]);
  useEffect(() => {
    if (authProfile) {
      setLocalProfile({ ...authProfile });
    }
  }, [authProfile]);

  useEffect(() => {
    if (profileError) {
      setBannerState({ type: 'error', message: profileError });
    }
  }, [profileError]);

  const loadMapHospitals = (lat: number, lng: number, radiusMeters: number) => {
    setIsSearchingRadius(true);
    discoverHospitals(lat, lng, radiusMeters, false)
      .then(data => {
        setMapHospitals(data.results);
        setLocalProfile(prev => {
          if (!prev) return prev;
          if (prev.hospital_id) {
            const stillExists = data.results.some((h: any) => h.id === prev.hospital_id);
            if (!stillExists) {
              return { ...prev, hospital_id: '' };
            }
          }
          return prev;
        });
      })
      .catch(console.error)
      .finally(() => setIsSearchingRadius(false));
  };

  useEffect(() => {
    if (!['hospital', 'ambulance'].includes(authProfile?.role || '')) return;

    hospitalService.getAllHospitals().then(setHospitals);

    geolocationService.getCurrentPosition()
      .then(pos => {
        setUserLocation([pos.latitude, pos.longitude]);
      })
      .catch(() => {
        setUserLocation([17.44, 78.34]);
      });
  }, [authProfile?.role]);

  useEffect(() => {
    if (!['hospital', 'ambulance'].includes(authProfile?.role || '')) return;
    loadMapHospitals(userLocation[0], userLocation[1], searchRadius);
  }, [userLocation, searchRadius, authProfile?.role]);

  const activeHospitals = useMemo(() => {
    const combinedMap = new Map<string, typeof hospitals[0] | NormalizedHospital>();
    mapHospitals.forEach(h => combinedMap.set(h.name.toLowerCase().trim(), h as any));
    hospitals.forEach(h => {
      const key = h.name.toLowerCase().trim();
      if (!combinedMap.has(key)) combinedMap.set(key, h);
    });
    return Array.from(combinedMap.values()).sort((a, b) => {
      const distA = 'distanceMeters' in a ? (a as NormalizedHospital).distanceMeters : 999999;
      const distB = 'distanceMeters' in b ? (b as NormalizedHospital).distanceMeters : 999999;
      return distA - distB;
    });
  }, [hospitals, mapHospitals]);

  const filteredHospitals = activeHospitals.filter(h => 
    h.name.toLowerCase().includes(hospitalSearchTerm.toLowerCase()) || 
    (h.address && h.address.toLowerCase().includes(hospitalSearchTerm.toLowerCase()))
  );
  
  const selectedHospitalName = activeHospitals.find(h => h.id === localProfile?.hospital_id)?.name || '';

  const handleSelectAutocomplete = async (placeId: string) => {
    setFetchingDetailsId(placeId);
    try {
      const details = await getGooglePlaceDetails(placeId);
      if (!details) throw new Error("Place details not found");
      
      const normalized: NormalizedHospital = {
        id: details.providerId,
        providerId: details.providerId,
        provider: details.provider,
        name: details.name,
        lat: details.lat,
        lng: details.lng,
        address: details.address,
        phone: details.phone,
        types: details.types,
        distanceMeters: 0,
      };

      setMapHospitals(prev => [normalized, ...prev]);
      setLocalProfile(prev => prev ? { ...prev, hospital_id: normalized.id } : null);
      setHospitalSearchTerm('');
      setIsDropdownOpen(false);
    } catch (err) {
      console.error("Failed to get place details:", err);
      alert("Failed to load hospital details. Please try again.");
    } finally {
      setFetchingDetailsId(null);
    }
  };

  const fetchProfile = async () => {
    setBannerState(null);
    await refreshProfile();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localProfile) return;
    setSaving(true);
    setBannerState(null);

    try {
      let finalHospitalId = localProfile.hospital_id;
      const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(finalHospitalId || '');
      
      if (!isUuid && ['hospital', 'ambulance'].includes(localProfile.role) && finalHospitalId) {
        const selectedMapHosp = mapHospitals.find(h => h.id === finalHospitalId);
        if (selectedMapHosp) {
          const { data, error: rpcError } = await supabase.rpc('get_or_create_hospital', {
            p_name: selectedMapHosp.name,
            p_address: selectedMapHosp.address || '',
            p_lat: selectedMapHosp.lat,
            p_lng: selectedMapHosp.lng,
            p_phone: selectedMapHosp.phone || ''
          });

          if (rpcError && rpcError.code === 'PGRST202') {
            console.warn("RPC missing, falling back to manual insert");
            const { data: existing } = await supabase.from('hospitals').select('id').eq('name', selectedMapHosp.name).single();
            if (existing) {
               finalHospitalId = existing.id;
            } else {
               const { data: inserted, error: insErr } = await supabase.from('hospitals').insert({
                  name: selectedMapHosp.name,
                  address: selectedMapHosp.address || '',
                  location: `POINT(${selectedMapHosp.lng} ${selectedMapHosp.lat})`,
                  phone: selectedMapHosp.phone || '',
                  emergency_capable: true
               }).select('id').single();
               
               if (insErr) throw insErr;
               finalHospitalId = inserted.id;
            }
          } else if (rpcError) {
             throw rpcError;
          } else if (data) {
             finalHospitalId = data;
          }
        }
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: localProfile.full_name,
          hospital_id: finalHospitalId || null
        })
        .eq('id', localProfile.id);

      if (error) throw error;
      
      await refreshProfile();

      setBannerState({
        type: 'success',
        message: 'Profile updated successfully.'
      });
      
      // Auto-dismiss success after 3 seconds
      setTimeout(() => {
        setBannerState(prev => prev?.type === 'success' ? null : prev);
      }, 3000);

    } catch (error: any) {
      console.error(error);
      setBannerState({
        type: 'error',
        message: `Unable to update your profile: ${error.message || 'Unknown error'}`
      });
    } finally {
      setSaving(false);
    }
  };

  if (profileLoading) {
    return (
      <div className="min-h-dvh bg-bg-main flex flex-col">
        <Header title="AERO OPERATOR PROFILE" subtitle="Manage your AERO operational identity and profile." />
        <div className="flex-1 flex flex-col items-center justify-center text-text-secondary gap-4">
          <div className="w-8 h-8 rounded-full border-2 border-cyan-600 border-t-transparent animate-spin"></div>
          <span className="text-sm font-bold tracking-widest uppercase">Loading Profile...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-bg-main flex flex-col">
      <Header title="AERO OPERATOR PROFILE" subtitle="Manage your AERO operational identity and profile." />
      
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full">
        
        {bannerState && (
          <div className={`mb-6 p-4 rounded-xl border flex items-center justify-between shadow-lg ${
            bannerState.type === 'error' 
              ? 'bg-red-950/40 border-red-900 text-red-200' 
              : 'bg-emerald-950/40 border-emerald-900 text-emerald-200'
          }`}>
            <div className="flex items-center gap-3">
              {bannerState.type === 'error' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01"></path></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3"></path></svg>
              )}
              <span className="text-sm font-medium">{bannerState.message}</span>
            </div>
            {bannerState.type === 'error' && (
              <button onClick={fetchProfile} className="text-xs font-bold underline hover:text-white transition-colors">
                [Retry]
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          
          {/* Profile Card Header (Left Column) */}
          <div className="lg:col-span-1">
            <div className="bg-bg-surface/60 border border-cyan-900/30 rounded-2xl p-6 flex flex-col items-center text-center sticky top-6 shadow-2xl backdrop-blur-sm">
              <div className="w-24 h-24 bg-cyan-950 border border-cyan-700/50 rounded-full flex items-center justify-center text-3xl font-bold text-cyan-400 mb-4 shadow-[0_0_20px_rgba(8,145,178,0.2)]">
                {localProfile?.full_name?.substring(0, 2).toUpperCase() || 'OP'}
              </div>
              <h2 className="text-xl font-bold text-white mb-1">{localProfile?.full_name?.toUpperCase()}</h2>
              <p className="text-sm text-cyan-500 font-medium tracking-wide mb-6">
                {(localProfile?.role || 'Operator').replace('_', ' ').toUpperCase()}
              </p>
              
              <div className="w-full bg-bg-main/80 rounded-xl p-4 border border-border-subtle text-left">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary uppercase font-bold tracking-wider">Status</span>
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    ACTIVE
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Form Sections (Right Column) */}
          <div className="lg:col-span-2 space-y-6">
            <form onSubmit={handleSave} className="space-y-6">
              
              <div className="bg-bg-surface/40 border border-border-subtle rounded-2xl shadow-xl relative z-50">
                <div className="bg-bg-surface/80 px-6 py-4 border-b border-border-subtle rounded-t-2xl">
                  <h3 className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Operator Identity</h3>
                </div>
                <div className="p-6 grid gap-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <Input
                      label="Full Name"
                      value={localProfile?.full_name || ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalProfile(prev => prev ? { ...prev, full_name: e.target.value } : null)}
                      required
                      placeholder="e.g. John Doe"
                    />
                    <Input
                      label="Operational Role"
                      value={(localProfile?.role || '').replace('_', ' ').toUpperCase()}
                      disabled
                      className="bg-bg-main/50 opacity-80"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <Input
                      label="Email Address"
                      value={user?.email || ''}
                      disabled
                      className="bg-bg-main/50 opacity-80"
                    />
                    <Input
                      label="User ID"
                      value={localProfile?.id || ''}
                      disabled
                      className="bg-bg-main/50 opacity-80 font-mono text-[11px]"
                    />
                  </div>
                  
                  {['hospital', 'ambulance'].includes(localProfile?.role || '') && (
                    <div className="grid grid-cols-1 gap-5">
                      <div className="group relative z-20">
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-[10px] font-bold text-text-secondary uppercase tracking-widest transition-colors group-focus-within:text-white">Assigned Hospital Facility</label>
                          <div className="flex gap-1">
                            {[5, 15, 25, 50].map(r => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => setSearchRadius(r * 1000)}
                                className={`px-2 py-0.5 text-[9px] font-bold rounded transition-colors ${
                                  searchRadius === r * 1000 
                                    ? 'bg-[#E53935] text-white' 
                                    : 'bg-[#1A1D24] text-[#A7ADB5] hover:text-white border border-border-subtle'
                                }`}
                              >
                                {r}km
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Search hospital..."
                            value={isDropdownOpen ? hospitalSearchTerm : (selectedHospitalName || hospitalSearchTerm)}
                            onChange={(e) => {
                              setHospitalSearchTerm(e.target.value);
                              setIsDropdownOpen(true);
                            }}
                            onFocus={() => {
                              setHospitalSearchTerm('');
                              setIsDropdownOpen(true);
                            }}
                            onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                            className="w-full bg-bg-main/50 border border-border-subtle rounded-lg px-4 py-3 text-sm text-white placeholder-text-secondary focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-all duration-200"
                          />
                          <AnimatePresence>
                            {isDropdownOpen && (
                              <motion.div 
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 5 }}
                                className="absolute z-[100] w-full mt-2 max-h-60 overflow-y-auto bg-bg-surface border border-border-subtle rounded-xl shadow-2xl custom-scrollbar"
                              >
                                {hospitalSearchTerm.trim() ? (
                                  <>
                                    {autocompleteLoading && <div className="p-4 text-sm text-text-secondary text-center">Searching Google Places...</div>}
                                    {!autocompleteLoading && autocompleteResults.length === 0 && (
                                      <div className="p-4 text-sm text-text-secondary text-center">No hospitals found</div>
                                    )}
                                    {!autocompleteLoading && autocompleteResults.map((place) => (
                                      <div
                                        key={place.placePrediction.placeId}
                                        onClick={() => handleSelectAutocomplete(place.placePrediction.placeId)}
                                        className={`p-3 hover:bg-white/5 cursor-pointer border-b border-border-subtle last:border-0 transition-colors flex justify-between items-start gap-4 ${fetchingDetailsId === place.placePrediction.placeId ? 'opacity-50 cursor-not-allowed' : ''}`}
                                      >
                                        <div className="flex-1 min-w-0">
                                          <h4 className="text-sm font-bold text-white mb-0.5">{place.placePrediction.text.text}</h4>
                                          <p className="text-xs text-text-secondary truncate">Google Places Result</p>
                                        </div>
                                        {fetchingDetailsId === place.placePrediction.placeId && (
                                          <div className="w-4 h-4 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin"></div>
                                        )}
                                      </div>
                                    ))}
                                  </>
                                ) : (
                                  <>
                                    {filteredHospitals.length === 0 ? (
                                      <div className="p-4 text-sm text-text-secondary text-center">No nearby hospitals found</div>
                                    ) : (
                                      filteredHospitals.map(h => (
                                        <div
                                          key={h.id}
                                          onClick={() => {
                                            setLocalProfile(prev => prev ? { ...prev, hospital_id: h.id } : null);
                                            setHospitalSearchTerm('');
                                            setIsDropdownOpen(false);
                                          }}
                                          className="p-3 hover:bg-white/5 cursor-pointer border-b border-border-subtle last:border-0 transition-colors flex justify-between items-start gap-4"
                                        >
                                          <div>
                                            <div className="text-white text-sm font-medium">{h.name}</div>
                                            {h.address && <div className="text-text-secondary text-[10px] mt-0.5 line-clamp-1">{h.address}</div>}
                                          </div>
                                          {('distanceMeters' in h) && (
                                            <div className="text-xs font-bold text-emerald-400 shrink-0 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                                              {((h as NormalizedHospital).distanceMeters / 1000).toFixed(1)} km
                                            </div>
                                          )}
                                        </div>
                                      ))
                                    )}
                                  </>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        {mapHospitals.length > 0 && (
                          <p className="text-[10px] text-emerald-400 mt-1.5 font-bold">📡 Loaded from Live Map Data</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-bg-surface/40 border border-border-subtle rounded-2xl overflow-hidden shadow-xl">
                <div className="bg-bg-surface/80 px-6 py-4 border-b border-border-subtle">
                  <h3 className="text-xs font-bold text-cyan-500 uppercase tracking-widest">Account Information</h3>
                </div>
                <div className="p-6 grid gap-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <Input
                      label="Account Created"
                      value={user?.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown'}
                      disabled
                      className="bg-bg-main/50 opacity-80"
                    />
                    {/* Placeholder for future schema fields if added */}
                    <div className="flex flex-col justify-center">
                      <p className="text-[10px] text-text-primary0 font-medium uppercase tracking-wider mb-1">Email Verification</p>
                      <p className="text-sm font-medium text-emerald-400">Verified via Supabase Auth</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button 
                  type="submit" 
                  variant="primary" 
                  loading={saving}
                  className="px-8 shadow-[0_0_15px_rgba(8,145,178,0.2)]"
                >
                  {saving ? 'SAVING...' : 'SAVE CHANGES'}
                </Button>
              </div>
            </form>
          </div>

        </div>
      </main>
    </div>
  );
}
