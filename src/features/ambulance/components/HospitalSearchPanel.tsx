import { useState, useRef, useEffect, Component, type ReactNode, type ErrorInfo } from 'react';
import type { NormalizedHospital } from '../../../services/hospitalSearch/types';
import { searchHospitalsByText } from '../../../services/hospitalSearch';

// --- ERROR BOUNDARY TO PREVENT ENTIRE PAGE BLANK SCREEN ---
class SearchErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[HospitalSearchPanel Crash Caught]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute top-4 left-3 right-3 md:right-auto md:left-4 z-30 md:w-[380px] bg-[#0F172A] p-4 rounded-xl shadow-2xl border border-red-500/50 pointer-events-auto">
          <p className="text-red-400 font-bold text-sm mb-1">Search Panel Notice</p>
          <p className="text-slate-300 text-xs">{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button 
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-1 px-3 rounded border border-slate-700 cursor-pointer"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface HospitalSearchPanelProps {
  hospitals: NormalizedHospital[];
  loading: boolean;
  error?: string | null;
  onSelect: (hospital: NormalizedHospital) => void;
  selectedHospitalId?: string;
  radiusKm: number;
  onRadiusChange: (radiusKm: number) => void;
  centerLocation: [number, number];
  gpsEnabled?: boolean;
}

function getHospitalSearchErrorMessage(err: any): string {
  const msg = err?.message || err?.status || err?.code || String(err);
  if (typeof msg === 'string') {
    if (msg.includes('PERMISSION_DENIED') || msg.includes('403')) return "Places search permission denied. Check API configuration.";
    if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) return "Search quota or rate limit reached.";
    if (msg.includes('INVALID_ARGUMENT') || msg.includes('400')) return "Invalid search request.";
    if (msg.includes('NETWORK') || msg.includes('Failed to fetch')) return "Unable to reach search service.";
  }
  return "Hospital search failed. Check network connection or configuration.";
}

export function HospitalSearchPanelInner({
  hospitals,
  loading,
  error,
  onSelect,
  selectedHospitalId,
  radiusKm,
  onRadiusChange,
  centerLocation,
  gpsEnabled = true,
}: HospitalSearchPanelProps) {
  const [open, setOpen] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const [localSearch, setLocalSearch] = useState('');
  const [ineligibleWarning, setIneligibleWarning] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [textSearchResults, setTextSearchResults] = useState<NormalizedHospital[]>([]);
  const [textSearchLoading, setTextSearchLoading] = useState(false);
  const [textSearchError, setTextSearchError] = useState<string | null>(null);

  // Auto-dismiss warning after 4s
  useEffect(() => {
    if (!ineligibleWarning) return;
    const t = setTimeout(() => setIneligibleWarning(null), 4000);
    return () => clearTimeout(t);
  }, [ineligibleWarning]);

  // Debounce text search
  useEffect(() => {
    if (!localSearch.trim() || localSearch.trim().length < 2) {
      setTextSearchResults([]);
      setTextSearchError(null);
      return;
    }

    const abortController = new AbortController();
    const handler = setTimeout(async () => {
      setTextSearchLoading(true);
      setTextSearchError(null);
      try {
        const { results } = await searchHospitalsByText(
          localSearch, 
          centerLocation[0] ?? 0, 
          centerLocation[1] ?? 0, 
          radiusKm * 1000, 
          abortController.signal
        );
        setTextSearchResults(results);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error("[Hospital Text Search] Provider error", err);
          setTextSearchError(getHospitalSearchErrorMessage(err));
          setTextSearchResults([]);
        }
      } finally {
        setTextSearchLoading(false);
      }
    }, 350);

    return () => {
      clearTimeout(handler);
      abortController.abort();
    };
  }, [localSearch, centerLocation, radiusKm]);

  const [visibleCount, setVisibleCount] = useState(35);

  useEffect(() => {
    setVisibleCount(35);
  }, [hospitals, radiusKm, localSearch]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 150) {
      setVisibleCount(prev => Math.min(prev + 30, hospitals.length));
    }
  };

  const handleFacilityClick = (h: NormalizedHospital) => {
    // Strict eligibility check: Only emergency-eligible facilities can become destinations
    if (h.isEmergencyEligible === false) {
      setIneligibleWarning(
        h.ineligibilityReason || 'This facility is unverified or not certified for acute emergency receiving.'
      );
      return;
    }

    setIneligibleWarning(null);
    onSelect(h);
    setOpen(false);
  };

  return (
    <>
      {/* Floating button to reopen search when hidden */}
      {!isVisible && (
        <button
          onClick={() => setIsVisible(true)}
          className="absolute top-4 left-4 z-30 bg-[#0F172A]/90 backdrop-blur-md rounded-full p-3 shadow-xl border border-slate-700 text-cyan-400 hover:bg-[#1E293B] hover:text-white transition-colors pointer-events-auto cursor-pointer"
          title="Show Hospital Search"
        >
          <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"/>
          </svg>
        </button>
      )}

      {/* Floating search panel */}
      {isVisible && (
        <div className="absolute top-4 left-3 right-3 md:right-auto md:left-4 z-30 md:w-[410px] pointer-events-auto transition-all duration-200">
          
          {/* Search bar container */}
          <div className="flex items-center gap-2 bg-[#0F172A]/95 backdrop-blur-md rounded-full px-4 md:px-5 h-[54px] md:h-[60px] border-2 border-cyan-500/50 shadow-[0_4px_20px_rgba(8,145,178,0.25)] focus-within:ring-2 focus-within:ring-cyan-500/30 transition-all">
            
            {/* Search Icon / Spinner */}
            {loading || textSearchLoading ? (
              <svg className="animate-spin w-5 h-5 text-cyan-400 shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : (
              <svg className="w-5 h-5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"/>
              </svg>
            )}

            {/* Input */}
            <input
              ref={inputRef}
              type="text"
              value={localSearch}
              onChange={e => setLocalSearch(e.target.value)}
              onFocus={() => setOpen(true)}
              placeholder={`Search hospitals within ${radiusKm} km...`}
              className="flex-1 text-[15px] md:text-[16px] font-medium text-white placeholder-slate-400 bg-transparent outline-none"
            />

            {/* Clear Button (X) */}
            {localSearch && (
              <button
                onClick={() => { setLocalSearch(''); inputRef.current?.focus(); }}
                className="text-slate-400 hover:text-white cursor-pointer shrink-0 p-1"
                title="Clear Search"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
              </button>
            )}

            {/* Hide Button */}
            <button
              onClick={() => setIsVisible(false)}
              className="text-slate-400 hover:text-white cursor-pointer shrink-0 text-[14px] md:text-[15px] font-medium ml-1 md:ml-2"
            >
              Hide
            </button>
          </div>

          {/* Warning Banner when an unverified facility is clicked */}
          {ineligibleWarning && (
            <div className="mt-2 bg-amber-950/90 border border-amber-500/60 p-3 rounded-xl text-amber-200 text-xs flex items-start gap-2.5 shadow-lg animate-in fade-in duration-200">
              <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
              </svg>
              <div className="flex-1">
                <p className="font-bold">Destination Selection Restricted</p>
                <p className="mt-0.5 text-amber-300/90 leading-tight">{ineligibleWarning}</p>
              </div>
              <button 
                onClick={() => setIneligibleWarning(null)}
                className="text-amber-400 hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            </div>
          )}

          {/* Results dropdown */}
          {open && (
            <div className="mt-2 bg-[#0F172A] rounded-2xl shadow-2xl border border-slate-700/80 overflow-hidden flex flex-col transition-all text-slate-200" style={{ maxHeight: '62vh' }}>
              
              {/* Header with Radius Selector */}
              {!localSearch.trim() && (
                <div className="px-4 py-3 border-b border-slate-800 flex flex-col gap-2 bg-[#182338]/90 shrink-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                      {!gpsEnabled ? 'DETECTING LOCATION...' :
                       loading ? `SEARCHING WITHIN ${radiusKm} KM...` : 
                       error ? (error.includes('configured') ? 'HOSPITAL SERVICE NOT CONFIGURED' : 'HOSPITAL SEARCH ERROR') :
                       hospitals.length > 0 ? (
                         <span>
                           <strong className="text-emerald-400">{hospitals.length} HOSPITALS FOUND</strong> ({radiusKm} KM)
                         </span>
                       ) :
                       `NO HOSPITALS WITHIN ${radiusKm} KM`}
                    </span>
                    {!loading && !error && hospitals.length > 0 && (
                      <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40">
                        TOMTOM PLACES
                      </span>
                    )}
                    {error && (
                      <button
                        onClick={() => onRadiusChange(radiusKm)}
                        className="text-[11px] text-cyan-400 underline hover:text-cyan-300 cursor-pointer"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {[5, 15, 25, 50].map(r => (
                      <button
                        key={r}
                        onClick={() => onRadiusChange(r)}
                        className={`px-3 py-1 rounded-full text-[12px] font-bold border transition-colors cursor-pointer ${
                          radiusKm === r 
                            ? 'bg-cyan-500 text-slate-950 font-bold border-cyan-400 shadow-sm' 
                            : 'bg-[#0B1220] text-slate-300 border-slate-700 hover:border-cyan-400 hover:text-cyan-300'
                        }`}
                      >
                        {r} km
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Autocomplete Result Header */}
              {localSearch.trim() && (
                <div className="px-4 py-3 border-b border-slate-800 flex flex-col gap-2 bg-[#182338]/90 shrink-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                      {textSearchLoading ? 'SEARCHING PLACES...' : `SEARCH RESULTS (${textSearchResults.length})`}
                    </span>
                    <span className="text-[10px] text-cyan-400 font-bold uppercase bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40">POI Discovery</span>
                  </div>
                </div>
              )}

              {/* List with correct scroll containment */}
              <div 
                className="overflow-y-auto flex-1 overscroll-contain divide-y divide-slate-800/80"
                style={{ minHeight: 0 }}
                onScroll={handleScroll}
                onWheelCapture={e => e.stopPropagation()}
              >
                {/* Autocomplete Mode */}
                {localSearch.trim() ? (
                  <>
                    {textSearchResults.length === 0 && !textSearchLoading && (
                      <div className="flex flex-col items-center justify-center py-10 text-center px-6">
                        <span className="text-3xl mb-3">🏥</span>
                        <p className="text-[14px] text-slate-300 font-semibold">
                          {textSearchError ? textSearchError : 'No hospitals found'}
                        </p>
                        {!textSearchError && (
                          <p className="text-[12px] text-slate-400 mt-1">Try another hospital name or increase the search radius.</p>
                        )}
                      </div>
                    )}
                    {textSearchResults.map((place) => {
                      const isSelected = place.id === selectedHospitalId;
                      const distKm = (place.distanceMeters ?? 0) / 1000;
                      const isEligible = place.isEmergencyEligible;

                      return (
                        <div 
                          key={place.id} 
                          onClick={() => handleFacilityClick(place)}
                          className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-colors cursor-pointer select-none ${
                            isSelected 
                              ? 'bg-emerald-950/30 border-l-4 border-l-emerald-400' 
                              : isEligible 
                                ? 'hover:bg-[#182338]' 
                                : 'hover:bg-[#182338]/40 opacity-75'
                          }`}
                        >
                          {/* Radio Selection Indicator */}
                          <div className="mt-0.5 shrink-0">
                            {isSelected ? (
                              <div className="w-5 h-5 rounded-full border-2 border-emerald-400 bg-emerald-500/20 flex items-center justify-center shadow-sm">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                              </div>
                            ) : isEligible ? (
                              <div className="w-5 h-5 rounded-full border-2 border-slate-600 flex items-center justify-center hover:border-cyan-400" />
                            ) : (
                              <div className="w-5 h-5 rounded-full border border-slate-700 bg-slate-800/60 flex items-center justify-center text-slate-500 text-[10px]" title="Non-emergency facility — selection disabled">
                                ✕
                              </div>
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className={`text-[14px] font-bold leading-tight truncate ${isSelected ? 'text-emerald-300' : 'text-white'}`}>
                                {place.name}
                              </p>
                              {distKm > 0 && (
                                <span className="text-[12px] font-mono font-bold shrink-0 text-cyan-400">
                                  {distKm.toFixed(1)} km
                                </span>
                              )}
                            </div>

                            {/* Verification Tier Badge */}
                            <div className="mt-1 flex items-center gap-2">
                              {place.provider === 'tomtom' ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 rounded-full">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  TomTom Places
                                </span>
                              ) : place.verificationTier === 'verified_emergency' ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 rounded-full">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  Verified Hospital
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-cyan-400 bg-cyan-950/80 border border-cyan-500/40 px-2 py-0.5 rounded-full">
                                  Hospital Facility
                                </span>
                              )}
                            </div>

                            <p className="text-[12px] text-slate-400 truncate mt-1">
                              {place.address || 'Address unavailable'}
                            </p>

                            {/* Ineligibility Reason Note */}
                            {!isEligible && (
                              <p className="text-[11px] text-amber-400/90 mt-1 font-medium flex items-center gap-1">
                                <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                                </svg>
                                {place.ineligibilityReason || 'Destination selection disabled'}
                              </p>
                            )}

                            {place.phone && (
                              <p className="text-[12px] text-cyan-400 mt-1 font-mono">{place.phone}</p>
                            )}
                          </div>

                          {/* Selected Destination Pill */}
                          {isSelected && (
                            <span className="text-[11px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/40 px-2.5 py-1 rounded-md shrink-0 flex items-center gap-1">
                              <svg className="w-3.5 h-3.5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                              </svg>
                              Selected
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </>
                ) : (
                  /* Nearby Radius Mode */
                  <>
                    {hospitals.length === 0 && !loading && (
                      <div className="flex flex-col items-center justify-center py-10 text-center px-6">
                        <span className="text-3xl mb-3">🏥</span>
                        <p className="text-[14px] text-slate-300 font-semibold">
                          {error ? error : `No hospitals found within ${radiusKm} km`}
                        </p>
                        <p className="text-[12px] text-slate-400 mt-1">Try selecting a larger search radius (15 km, 25 km, 50 km)</p>
                      </div>
                    )}
                    {hospitals.slice(0, visibleCount).map((h) => {
                      const isSelected = h.id === selectedHospitalId;
                      const distKm = (h.distanceMeters ?? 0) / 1000;
                      const isEligible = h.isEmergencyEligible;
                      const urgencyColor = distKm < 3 ? 'text-emerald-400' : distKm < 8 ? 'text-amber-400' : 'text-cyan-400';

                      return (
                        <div
                          key={h.id}
                          onClick={() => handleFacilityClick(h)}
                          className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-colors cursor-pointer select-none ${
                            isSelected 
                              ? 'bg-emerald-950/30 border-l-4 border-l-emerald-400' 
                              : isEligible 
                                ? 'hover:bg-[#182338]' 
                                : 'hover:bg-[#182338]/40 opacity-75'
                          }`}
                        >
                          {/* Radio Selection Indicator */}
                          <div className="mt-0.5 shrink-0">
                            {isSelected ? (
                              <div className="w-5 h-5 rounded-full border-2 border-emerald-400 bg-emerald-500/20 flex items-center justify-center shadow-sm">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                              </div>
                            ) : isEligible ? (
                              <div className="w-5 h-5 rounded-full border-2 border-slate-600 flex items-center justify-center hover:border-cyan-400" />
                            ) : (
                              <div className="w-5 h-5 rounded-full border border-slate-700 bg-slate-800/60 flex items-center justify-center text-slate-500 text-[10px]" title="Non-emergency facility — selection disabled">
                                ✕
                              </div>
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className={`text-[14px] font-bold leading-tight truncate ${isSelected ? 'text-emerald-300' : 'text-white'}`}>
                                {h.name}
                              </p>
                              <span className={`text-[12px] font-mono font-bold shrink-0 ${urgencyColor}`}>
                                {distKm.toFixed(1)} km
                              </span>
                            </div>

                            {/* Verification Tier Badge */}
                            <div className="mt-1 flex items-center gap-2">
                              {h.provider === 'tomtom' ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 rounded-full">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  TomTom Places
                                </span>
                              ) : h.verificationTier === 'verified_emergency' ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 rounded-full">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  Verified Hospital
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-cyan-400 bg-cyan-950/80 border border-cyan-500/40 px-2 py-0.5 rounded-full">
                                  Hospital Facility
                                </span>
                              )}
                            </div>

                            {h.address && (
                              <p className="text-[12px] text-slate-400 mt-1 leading-tight truncate">{h.address}</p>
                            )}

                            {/* Ineligibility Reason Note */}
                            {!isEligible && (
                              <p className="text-[11px] text-amber-400/90 mt-1 font-medium flex items-center gap-1">
                                <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                                </svg>
                                {h.ineligibilityReason || 'Destination selection disabled'}
                              </p>
                            )}

                            {h.phone && (
                              <p className="text-[12px] text-cyan-400 mt-1 font-mono">{h.phone}</p>
                            )}
                          </div>

                          {/* Selected Destination Pill */}
                          {isSelected && (
                            <span className="text-[11px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/40 px-2.5 py-1 rounded-md shrink-0 flex items-center gap-1">
                              <svg className="w-3.5 h-3.5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                              </svg>
                              Selected
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {/* Windowed pagination indicator */}
                    {hospitals.length > visibleCount && (
                      <div className="py-2.5 text-center text-xs text-slate-400 bg-slate-900/60 border-t border-slate-800">
                        Showing {visibleCount} of {hospitals.length} facilities (scroll for more)
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function HospitalSearchPanel(props: HospitalSearchPanelProps) {
  return (
    <SearchErrorBoundary>
      <HospitalSearchPanelInner {...props} />
    </SearchErrorBoundary>
  );
}
