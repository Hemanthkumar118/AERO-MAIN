import { useState, useEffect, useRef } from 'react';
import { Minus, Plus, ChevronRight, CheckCircle2, Clock } from 'lucide-react';
import type { EmergencyIncident, SOSState } from '../../../types';
import { useToast } from '../../../components/ui/Toast';

interface SOSInformationPanelProps {
  incident: EmergencyIncident;
  navigationStatus: 'idle' | 'active' | 'rerouting' | 'arrived' | 'error';
  routeInfo?: any | null;
  onAbort: () => void;
  onComplete: () => void;
}

export function SOSInformationPanel({
  incident,
  navigationStatus,
  routeInfo,
  onAbort,
  onComplete
}: SOSInformationPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const { addToast } = useToast();
  const prevCorridorStatus = useRef(incident.corridor_status);

  useEffect(() => {
    if (incident.corridor_status && incident.corridor_status !== prevCorridorStatus.current) {
      if (incident.corridor_status !== 'PENDING') {
        const statusColors: any = {
          'CLEAR': 'success',
          'CLEARING': 'info',
          'CAUTION': 'warning',
          'BLOCKED': 'error'
        };
        addToast({
          variant: statusColors[incident.corridor_status] || 'info',
          title: 'Police Update',
          message: `Corridor status changed to ${incident.corridor_status}`,
        });
      }
      prevCorridorStatus.current = incident.corridor_status;
    }
  }, [incident.corridor_status, addToast]);

  const prevRouteVersion = useRef(incident.route_version);
  
  useEffect(() => {
    if (incident.route_version && incident.route_version > (prevRouteVersion.current || 1)) {
      addToast({
        variant: 'info',
        title: 'Route Updated',
        message: 'A faster route has been found and applied.',
      });
      prevRouteVersion.current = incident.route_version;
    }
  }, [incident.route_version, addToast]);

  const effectiveDistanceMeters = incident.route_distance_meters ?? routeInfo?.distanceMeters ?? null;
  const effectiveEtaSeconds = (incident.traffic_duration_seconds || incident.route_duration_seconds) ?? routeInfo?.trafficAwareEtaSeconds ?? routeInfo?.etaSeconds ?? null;
  const isTrafficAware = (incident.traffic_status === 'LIVE' || incident.route_provider === 'tomtom' || routeInfo?.isTrafficAware) && incident.traffic_status !== 'UNAVAILABLE';
  const effectiveTrafficStatus = incident.traffic_status || routeInfo?.trafficStatus || (isTrafficAware ? 'LIVE' : 'UNAVAILABLE');
  const delaySec = (incident.traffic_duration_seconds && incident.route_duration_seconds)
    ? Math.max(0, incident.traffic_duration_seconds - incident.route_duration_seconds)
    : (routeInfo?.trafficDelaySeconds || 0);

  // Derive SOSState directly in the panel
  const sosState: SOSState = {
    status: incident.status === 'cancelled' ? 'ABORTED' : (incident.status === 'resolved' || incident.status === 'arrived' ? 'COMPLETED' : 'ACTIVE'),
    emergencyId: incident.id,
    routeStatus: navigationStatus === 'error' ? 'ERROR' : ((incident.route_geometry || routeInfo?.polyline) ? 'SUCCESS' : 'PENDING'),
    policeStatus: incident.police_acknowledged_at ? 'DELIVERED' : (incident.corridor_status !== 'PENDING' ? 'SENT' : 'PENDING'),
    hospitalStatus: incident.hospital_status === 'READY' ? 'DELIVERED' : (incident.hospital_status === 'ACCEPTED' ? 'SENT' : 'PENDING'),
    ambulanceLocation: { latitude: incident.current_latitude || 0, longitude: incident.current_longitude || 0 },
    destination: {
      id: 'dest',
      name: incident.destination_hospital || 'Hospital',
      address: incident.destination_hospital || '',
      location: { latitude: incident.destination_latitude, longitude: incident.destination_longitude },
      emergencyCapable: true,
    } as any,
    distanceMeters: effectiveDistanceMeters,
    etaSeconds: effectiveEtaSeconds,
    trafficAwareEtaSeconds: effectiveEtaSeconds,
    trafficStatus: effectiveTrafficStatus as any,
    speedKmH: incident.current_speed,
    startedAt: incident.created_at,
    updatedAt: incident.updated_at,
  };

  if (!expanded) {
    return (
      <div className="absolute top-20 right-4 z-30 pointer-events-auto">
        <div className="bg-bg-surface/90 backdrop-blur-md border border-border-subtle rounded-lg shadow-lg p-3 flex items-center justify-between gap-4 w-[200px]">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-sm">SOS</span>
            <div className="flex items-center gap-1 text-[10px] font-bold text-[#FF3B30] bg-[#FF3B30]/10 px-2 py-0.5 rounded-full border border-[#FF3B30]/20 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF3B30]" />
              ACTIVE
            </div>
          </div>
          <button onClick={() => setExpanded(true)} className="text-text-secondary hover:text-white p-1 rounded hover:bg-bg-elevated transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute top-20 right-4 z-30 pointer-events-auto max-w-[320px] w-[calc(100vw-24px)] md:w-[320px] max-h-[calc(100vh-220px)] md:max-h-[calc(100vh-120px)] overflow-y-auto custom-scrollbar">
      <div className="bg-bg-surface/95 backdrop-blur-xl border border-border-subtle rounded-xl shadow-2xl overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="bg-bg-elevated/80 border-b border-border-subtle px-3 py-2.5 flex items-center justify-between">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold text-white tracking-widest uppercase">SOS INFORMATION</h2>
              <div className="flex items-center gap-1 text-[9px] font-bold text-[#FF3B30] bg-[#FF3B30]/10 px-2 py-0.5 rounded-full border border-[#FF3B30]/20 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FF3B30]" />
                ACTIVE
              </div>
            </div>
          </div>
          <button onClick={() => setExpanded(false)} className="text-text-secondary hover:text-white p-1 rounded hover:bg-bg-subtle transition-colors">
            <Minus className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-2.5 space-y-2 text-[13px]">
          
          {/* Emergency Info */}
          <div>
            <div className="text-[11px] text-text-secondary uppercase mb-0.5">Emergency ID</div>
            <div className="font-mono text-white text-[11px] select-all bg-bg-elevated px-2 py-1 rounded border border-border-subtle overflow-hidden text-ellipsis whitespace-nowrap">
              {sosState.emergencyId}
            </div>
          </div>

          <div className="pt-1.5 border-t border-border-subtle">
            <div className="text-[11px] text-text-secondary uppercase mb-0.5">Destination</div>
            <div className="font-bold text-white text-sm">{sosState.destination?.name}</div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-border-subtle">
            <div>
              <div className="text-[11px] text-text-secondary uppercase mb-0.5 flex justify-between items-center pr-2">
                <span>Distance</span>
              </div>
              <div className="font-bold text-white text-base">
                {effectiveDistanceMeters != null ? (
                  effectiveDistanceMeters >= 1000 ? (effectiveDistanceMeters / 1000).toFixed(1) + ' km' : effectiveDistanceMeters + ' m'
                ) : (
                  <span className="text-xs text-text-secondary font-mono">{navigationStatus === 'rerouting' ? 'RECALCULATING...' : 'CALCULATING...'}</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-text-secondary uppercase mb-0.5 flex items-center justify-between">
                <span>ETA</span>
                {isTrafficAware ? (
                  <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30 font-bold tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    TRAFFIC-AWARE
                  </span>
                ) : effectiveTrafficStatus === 'UNAVAILABLE' ? (
                  <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.5 rounded border border-amber-500/30 font-bold">
                    TRAFFIC UNAVAILABLE
                  </span>
                ) : (
                  <span className="text-[9px] bg-bg-elevated text-text-secondary px-1 py-0.5 rounded border border-border-subtle font-bold uppercase">
                    STANDARD ROUTE
                  </span>
                )}
              </div>
              <div className="font-bold text-white text-base flex items-baseline gap-1.5 flex-wrap">
                {effectiveEtaSeconds != null ? (
                  <>
                    <span>{Math.round(effectiveEtaSeconds / 60)} min</span>
                    {delaySec > 60 && (
                      <span className="text-[10px] text-amber-400 font-bold">
                        (+{Math.round(delaySec / 60)}m delay)
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-text-secondary font-mono">{navigationStatus === 'rerouting' ? 'RECALCULATING...' : 'CALCULATING...'}</span>
                )}
              </div>
              {(incident.route_updated_at || routeInfo?.calculatedAt) && (
                <div className="text-[9px] text-slate-400 mt-0.5 font-mono">
                  Calculated: {new Date(incident.route_updated_at || routeInfo.calculatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
              )}
            </div>
          </div>

          <div className="pt-1.5 border-t border-border-subtle">
            <div className="text-[11px] text-text-secondary uppercase mb-0.5 flex justify-between items-center">
              <span>Speed</span>
              {sosState.speedKmH != null && <span className="text-[9px] text-[#35C7FF] bg-[#35C7FF]/10 px-1 py-0.5 rounded font-bold">{Math.round(sosState.speedKmH)} km/h</span>}
            </div>
          </div>

          <div className="pt-1.5 border-t border-border-subtle">
            <div className="text-[11px] text-text-secondary uppercase mb-0.5">Navigation</div>
            <div className="font-bold text-[#35C7FF] flex items-center gap-1.5">
              <ChevronRight className="w-3.5 h-3.5" />
              {navigationStatus === 'error' ? 'ROUTE ERROR' : (navigationStatus === 'rerouting' ? 'REROUTING...' : (navigationStatus === 'arrived' ? 'ARRIVED' : 'ON ROUTE'))}
            </div>
          </div>

          <div className="pt-1.5 border-t border-border-subtle">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[11px] text-text-secondary uppercase">Police Corridor Status</span>
            </div>
            <div className={`font-bold flex items-center gap-1.5 text-[13px] px-2.5 py-1.5 rounded-lg border ${
              incident.corridor_status === 'CLEAR' ? 'bg-[#20D67A]/10 text-[#20D67A] border-[#20D67A]/30' : 
              incident.corridor_status === 'CLEARING' ? 'bg-[#35C7FF]/10 text-[#35C7FF] border-[#35C7FF]/30' : 
              incident.corridor_status === 'CAUTION' ? 'bg-yellow-400/10 text-yellow-400 border-yellow-400/30' : 
              incident.corridor_status === 'BLOCKED' ? 'bg-red-500/10 text-red-500 border-red-500/30' : 
              'bg-bg-elevated text-text-secondary border-border-subtle'
            }`}>
              {incident.corridor_status === 'CLEAR' ? <CheckCircle2 className="w-4 h-4" /> : 
               incident.corridor_status === 'PENDING' ? <Clock className="w-4 h-4" /> : 
               <ChevronRight className="w-4 h-4" />}
              {incident.corridor_status || 'PENDING'}
              {incident.corridor_status === 'CLEAR' && (
                <span className="ml-auto text-[9px] font-black tracking-widest uppercase animate-pulse">SAFE TO PROCEED</span>
              )}
            </div>
          </div>

          <div className="pt-1.5 border-t border-border-subtle">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[11px] text-text-secondary uppercase">Hospital ER Readiness</span>
            </div>
            <div className={`font-bold flex items-center gap-1.5 text-[13px] px-2.5 py-1.5 rounded-lg border ${
              incident.hospital_status === 'READY' ? 'bg-[#20D67A]/10 text-[#20D67A] border-[#20D67A]/30' : 
              incident.hospital_status === 'ACCEPTED' ? 'bg-[#35C7FF]/10 text-[#35C7FF] border-[#35C7FF]/30' : 
              'bg-bg-elevated text-text-secondary border-border-subtle'
            }`}>
              {incident.hospital_status === 'READY' ? <CheckCircle2 className="w-4 h-4" /> : 
               <Clock className="w-4 h-4" />}
              {incident.hospital_status || 'PENDING'}
              {incident.hospital_status === 'READY' && (
                <span className="ml-auto text-[9px] font-black tracking-widest uppercase animate-pulse">BAY CLEARED</span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1.5 border-t border-border-subtle">
             <button
               onClick={onAbort}
               className="flex-1 px-2.5 py-1.5 rounded-lg bg-bg-elevated hover:bg-red-500/10 text-red-500 border border-border-subtle hover:border-red-500/30 transition-colors font-bold text-[11px]"
             >
               ABORT
             </button>
             <button
               onClick={onComplete}
               className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#20D67A]/10 hover:bg-[#20D67A]/20 text-[#20D67A] border border-[#20D67A]/30 transition-colors font-bold text-[11px]"
             >
               MARK ARRIVED
             </button>
          </div>

        </div>
      </div>
    </div>
  );
}
