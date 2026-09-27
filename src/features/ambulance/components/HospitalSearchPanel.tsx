/**
 * HospitalSearchPanel
 * Floating list of hospitals on the map.
 * This is now a dumb component that receives hospitals from the parent.
 */

import { useState, useRef, useEffect } from 'react';
import type { NormalizedHospital } from '../../../services/hospitalSearch/types';

interface HospitalSearchPanelProps {
  hospitals: NormalizedHospital[];
  loading: boolean;
  error?: string | null;
  onSelect: (hospital: NormalizedHospital) => void;
  selectedHospitalId?: string;
  radiusKm: number;
  onRadiusChange: (radiusKm: number) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function HospitalSearchPanel({
  hospitals,
  loading,
  error,
  onSelect,
  selectedHospitalId,
  radiusKm,
  onRadiusChange,
  searchQuery,
  onSearchChange,
}: HospitalSearchPanelProps) {
  const [open, setOpen] = useState(true);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      onSearchChange(localSearch);
    }, 300);
    return () => clearTimeout(handler);
  }, [localSearch, onSearchChange]);

  const handleSelect = (h: NormalizedHospital) => {
    onSelect(h);
    setOpen(false);
  };

  return (
    <>
      {/* Floating search panel — absolute positioned over map */}
      <div className="absolute top-14 left-3 z-[500] w-[320px] max-w-[calc(100vw-1.5rem)] pointer-events-auto">

        {/* Search bar */}
        <div className={`flex items-center gap-2 bg-bg-surface shadow-lg border rounded-2xl px-3 py-2 transition-all ${open ? 'border-[#35C7FF] ring-2 ring-[#35C7FF]/20' : 'border-border-subtle'}`}>
          {loading ? (
            <svg className="animate-spin w-4 h-4 text-[#35C7FF] shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          ) : (
            <svg className="w-4 h-4 text-text-secondary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"/>
            </svg>
          )}
          <input
            ref={inputRef}
            type="text"
            value={localSearch}
            onChange={e => setLocalSearch(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={`Search hospitals within ${radiusKm} km…`}
            className="flex-1 text-xs text-white placeholder-text-secondary bg-transparent outline-none"
          />
          {localSearch && (
            <button
              onClick={() => { setLocalSearch(''); inputRef.current?.focus(); }}
              className="text-text-secondary hover:text-white cursor-pointer shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
              </svg>
            </button>
          )}
          {open && (
            <button
              onClick={() => setOpen(false)}
              className="text-text-secondary hover:text-white cursor-pointer shrink-0 text-[10px] font-medium"
            >
              ESC
            </button>
          )}
        </div>

        {/* Results dropdown */}
        {open && (
          <div className="mt-1.5 bg-bg-surface rounded-2xl shadow-xl border border-border-subtle overflow-hidden flex flex-col" style={{ maxHeight: '60vh' }}>
            {/* Header with Radius Selector */}
            <div className="px-3 py-2 border-b border-border-subtle flex flex-col gap-2 bg-bg-elevated shrink-0">
              <div className="flex items-center justify-between">
                <span className="telemetry-label text-[10px] font-bold uppercase">
                  {loading ? 'SEARCHING NEARBY HOSPITALS...' : 
                   error ? (error.includes('configured') ? 'HOSPITAL SERVICE NOT CONFIGURED' : 'HOSPITAL SEARCH ERROR') :
                   hospitals.length > 0 ? `${hospitals.length} HOSPITALS FOUND` : 
                   'NO HOSPITALS FOUND'}
                </span>
                {!loading && !error && hospitals.length > 0 && (
                  <span className="text-[10px] text-[#35C7FF] font-medium">📡 Live Map Data</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                {[5, 15, 25, 50].map(r => (
                  <button
                    key={r}
                    onClick={() => onRadiusChange(r)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      radiusKm === r 
                        ? 'bg-[#35C7FF] text-bg-main border-[#35C7FF]' 
                        : 'bg-bg-main text-text-secondary border-border-subtle hover:text-white'
                    }`}
                  >
                    {r} km
                  </button>
                ))}
              </div>
            </div>

            {/* List with correct scroll containment */}
            <div 
              className="overflow-y-auto flex-1 overscroll-contain"
              style={{ minHeight: 0 }}
              onWheelCapture={e => e.stopPropagation()}
            >
              {hospitals.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                  <span className="text-2xl mb-2">🏥</span>
                  <p className="text-xs text-text-secondary font-medium">
                    {error ? error : 'NO HOSPITALS FOUND'}
                  </p>
                  <p className="text-[10px] text-text-secondary mt-1">Try a different search or extend the radius</p>
                </div>
              )}
              {hospitals.map((h, i) => {
                const isSelected = h.id === selectedHospitalId;
                const distKm = (h as any).drivingDistanceMeters ? (h as any).drivingDistanceMeters / 1000 : h.distanceMeters / 1000;
                const urgencyColor = distKm < 3 ? 'text-[#20D67A]' : distKm < 8 ? 'text-[#FFB020]' : 'text-[#35C7FF]';
                return (
                  <div key={h.id} className="flex flex-col border-b border-border-subtle last:border-0">
                    <button
                      onClick={() => handleSelect(h)}
                      className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 hover:bg-bg-elevated transition-colors cursor-pointer ${
                        isSelected ? 'bg-[#35C7FF]/10' : ''
                      }`}
                    >
                      {/* Rank badge */}
                      <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                        i === 0 ? 'bg-[#20D67A] text-bg-main' : 'bg-bg-elevated border border-border-subtle text-text-secondary'
                      }`}>
                        {i === 0 ? '★' : i + 1}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1">
                          <p className={`text-xs font-bold leading-tight truncate ${isSelected ? 'text-[#35C7FF]' : 'text-white'}`}>
                            {h.name}
                          </p>
                          <span className={`text-[11px] font-mono font-bold shrink-0 ${urgencyColor}`}>
                            {distKm.toFixed(1)} km
                          </span>
                        </div>
                        {h.address && (
                          <p className="text-[10px] text-text-secondary mt-0.5 leading-tight truncate">{h.address}</p>
                        )}
                        {h.businessStatus && (
                          <p className={`text-[10px] mt-0.5 font-bold ${h.businessStatus === 'OPERATIONAL' ? 'text-[#20D67A]' : 'text-[#FFB020]'}`}>
                            {h.businessStatus.replace('_', ' ')}
                          </p>
                        )}
                        {h.phone && (
                          <p className="text-[10px] text-[#35C7FF] mt-0.5 font-mono">{h.phone}</p>
                        )}
                      </div>

                      {isSelected && (
                        <svg className="w-4 h-4 text-[#35C7FF] shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
