import { useState } from 'react';
import { 
  AlertTriangle, 
  RotateCw, 
  MapPin, 
  ChevronRight,
  X
} from 'lucide-react';
import type { Hospital, RouteInfo } from '../../../types';
import { SOSController } from './SOSController';

interface AmbulanceNavigationPanelProps {
  hospital: Hospital;
  ambulanceId: string;
  currentPos: [number, number];
  routeInfo: RouteInfo | null;
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
  onSelectAlternative?: (index: number) => void;
  selectedAlternativeIndex?: number;
  onEmergencyActive: (emergency: any) => void;
  onCancelDestination: () => void;
}

export function AmbulanceNavigationPanel({
  hospital,
  ambulanceId,
  currentPos,
  routeInfo,
  loading,
  error,
  onRefresh,
  onSelectAlternative,
  selectedAlternativeIndex = 0,
  onEmergencyActive,
  onCancelDestination,
}: AmbulanceNavigationPanelProps) {
  const [selectedIncident, setSelectedIncident] = useState<any | null>(null);

  // Compute arrival clock time
  const etaMinutes = routeInfo ? Math.round(routeInfo.etaSeconds / 60) : null;
  const arrivalTime = etaMinutes != null 
    ? new Date(Date.now() + etaMinutes * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  const distanceKm = routeInfo 
    ? (routeInfo.distanceMeters / 1000).toFixed(1)
    : (hospital.distanceKm ? hospital.distanceKm.toFixed(1) : null);

  const trafficDelayMin = routeInfo?.trafficDelaySeconds 
    ? Math.round(routeInfo.trafficDelaySeconds / 60) 
    : 0;

  const isTrafficAware = Boolean(routeInfo?.isTrafficAware && routeInfo.trafficStatus !== 'UNAVAILABLE');
  const routeIncidents = routeInfo?.routeIncidents || [];
  const alternatives = routeInfo?.alternatives || [];

  return (
    <div className="w-[380px] max-w-[calc(100vw-24px)] bg-[#0F172A]/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto transition-all duration-300">
      
      {/* ── Top Header / Route Status Banner ── */}
      <div className="bg-[#1E293B]/90 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {loading ? (
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold tracking-wider">
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
              <span>CALCULATING LIVE ROUTE...</span>
            </div>
          ) : isTrafficAware ? (
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-[11px] font-bold text-emerald-400 tracking-wider uppercase">
                TOMTOM TRAFFIC-AWARE ROUTE
              </span>
            </div>
          ) : routeInfo?.routeProvider === 'osrm' ? (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-400"></span>
              <span className="text-[11px] font-bold text-slate-300 tracking-wider uppercase">
                STANDARD ROUTE (NO LIVE TRAFFIC)
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              <span className="text-[11px] font-bold text-amber-300 tracking-wider uppercase">
                TRAFFIC DATA UNAVAILABLE
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh Route & Traffic"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onCancelDestination}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Change Destination"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Main Content Area ── */}
      <div className="p-4 flex flex-col gap-3.5 text-slate-200">
        
        {/* Destination Hospital Summary */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-cyan-400 text-[11px] font-bold uppercase tracking-wider mb-0.5">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span>Target Hospital</span>
            </div>
            <h3 className="text-base font-bold text-white truncate leading-tight">
              {hospital.name}
            </h3>
            {hospital.address && (
              <p className="text-[12px] text-slate-400 truncate mt-0.5">
                {hospital.address}
              </p>
            )}
          </div>
          {hospital.phone && (
            <a 
              href={`tel:${hospital.phone}`} 
              className="text-[11px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 rounded px-2 py-1 shrink-0 hover:bg-cyan-900/50 transition-colors"
            >
              Call ER
            </a>
          )}
        </div>

        {/* Big ETA & Distance Hero Box */}
        <div className="bg-[#0B1220] border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">
              ESTIMATED TRAVEL TIME
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-white tracking-tight">
                {loading ? '...' : (etaMinutes != null ? `${etaMinutes} min` : '--')}
              </span>
              {arrivalTime && !loading && (
                <span className="text-[12px] font-medium text-slate-400">
                  (ETA {arrivalTime})
                </span>
              )}
            </div>
          </div>

          <div className="text-right border-l border-slate-800/80 pl-4">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">
              DISTANCE
            </div>
            <div className="text-xl font-bold text-cyan-300 font-mono">
              {loading ? '...' : (distanceKm ? `${distanceKm} km` : '--')}
            </div>
          </div>
        </div>

        {/* Live Traffic Conditions Indicator */}
        {!loading && routeInfo && (
          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              {trafficDelayMin > 3 ? (
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
              ) : trafficDelayMin > 0 ? (
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
              ) : (
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              )}
              <span className="font-semibold text-slate-200">
                {trafficDelayMin > 3 
                  ? `Heavy Congestion (+${trafficDelayMin}m delay)` 
                  : trafficDelayMin > 0 
                  ? `Moderate Slowdown (+${trafficDelayMin}m delay)` 
                  : 'Free-Flowing Live Traffic (Optimal Flow)'}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {routeInfo.calculatedAt 
                ? new Date(routeInfo.calculatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                : 'Just now'}
            </span>
          </div>
        )}

        {/* Route Alternatives Selection (when TomTom returns multiple options) */}
        {!loading && alternatives.length > 1 && onSelectAlternative && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Available Route Alternatives:
            </span>
            <div className="grid grid-cols-2 gap-2">
              {alternatives.map((alt, idx) => {
                const isSelected = selectedAlternativeIndex === idx;
                const altMin = Math.round(alt.durationSeconds / 60);
                const delayDiff = idx === 0 ? 0 : Math.round((alt.durationSeconds - alternatives[0].durationSeconds) / 60);
                
                return (
                  <button
                    key={alt.id}
                    onClick={() => onSelectAlternative(idx)}
                    className={`px-2.5 py-2 rounded-lg text-left transition-all border cursor-pointer ${
                      isSelected 
                        ? 'bg-cyan-950/60 border-cyan-500 text-white shadow-[0_0_12px_rgba(6,182,212,0.2)]' 
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold">
                        {idx === 0 ? 'Fastest' : `Route ${idx + 1}`}
                      </span>
                      <span className="text-[11px] font-mono font-bold text-cyan-400">
                        {altMin}m
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {idx === 0 ? 'Via fastest flow' : (delayDiff > 0 ? `+${delayDiff}m slower` : 'Same ETA')}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Relevant Route Incidents Warning */}
        {!loading && routeIncidents.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px] font-bold text-amber-400 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{routeIncidents.length} Incident(s) Affecting Route</span>
              </span>
            </div>
            
            <div className="space-y-1.5">
              {routeIncidents.slice(0, 2).map((inc: any) => (
                <div 
                  key={inc.id}
                  onClick={() => setSelectedIncident(inc)}
                  className="bg-amber-950/20 border border-amber-500/30 rounded-lg p-2 flex items-center justify-between cursor-pointer hover:bg-amber-950/40 transition-colors text-left"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="text-[12px] font-bold text-amber-300 truncate">
                      {inc.category || 'Traffic Delay'}: {inc.description}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {inc.from ? `Near ${inc.from}` : 'Along corridor'}
                      {inc.delayMinutes > 0 ? ` • +${inc.delayMinutes}m delay` : ''}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-amber-400 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Notification if route calculation failed */}
        {error && (
          <div className="bg-red-950/40 border border-red-500/40 rounded-lg p-2.5 text-xs text-red-300 flex items-center justify-between">
            <span>{error}</span>
            <button 
              onClick={onRefresh}
              className="text-white bg-red-600 hover:bg-red-500 px-2 py-1 rounded text-[11px] font-bold cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Action Section: Prominent SOS Button ── */}
        <div className="pt-2 border-t border-slate-800">
          <SOSController
            hospital={hospital}
            ambulanceId={ambulanceId}
            currentPos={currentPos}
            patientData={{ category: 'CARDIAC', priority: 'CODE_RED', chiefComplaint: 'Emergency Dispatch' }}
            previewRoute={routeInfo}
            onEmergencyActive={onEmergencyActive}
          />
        </div>

      </div>

      {/* Incident Detail Modal */}
      {selectedIncident && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0F172A] border border-amber-500/40 rounded-xl p-5 max-w-sm w-full shadow-2xl text-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>ROUTE TRAFFIC INCIDENT</span>
              </div>
              <button 
                onClick={() => setSelectedIncident(null)}
                className="text-slate-400 hover:text-white p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div>
                <span className="text-slate-400 uppercase text-[10px]">Type</span>
                <p className="font-bold text-white text-sm">{selectedIncident.category}</p>
              </div>
              <div>
                <span className="text-slate-400 uppercase text-[10px]">Description</span>
                <p className="text-slate-300">{selectedIncident.description}</p>
              </div>
              {selectedIncident.delayMinutes > 0 && (
                <div>
                  <span className="text-slate-400 uppercase text-[10px]">Traffic Delay</span>
                  <p className="font-bold text-amber-400 text-sm">+{selectedIncident.delayMinutes} minutes</p>
                </div>
              )}
              {selectedIncident.from && (
                <div>
                  <span className="text-slate-400 uppercase text-[10px]">Location</span>
                  <p className="text-slate-300">{selectedIncident.from} {selectedIncident.to ? `to ${selectedIncident.to}` : ''}</p>
                </div>
              )}
            </div>
            <button 
              onClick={() => setSelectedIncident(null)}
              className="mt-4 w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 rounded-lg text-xs"
            >
              Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
