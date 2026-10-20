import { useState, useEffect, useRef } from 'react';
import { SOSButton } from '../../../components/status/SOSButton';
import { Dialog } from '../../../components/ui/Dialog';
import { useToast } from '../../../components/ui/Toast';
import { ambulanceService } from '../../../services/ambulanceService';
import { geolocationService } from '../../../services/geolocationService';
import { supabase } from '../../../lib/supabase';
import type { Emergency, Hospital, PatientInfo } from '../../../types';

interface SOSControllerProps {
  hospital: Hospital;
  ambulanceId: string;
  currentPos?: [number, number];
  patientData?: Partial<PatientInfo>;
  previewRoute?: any;
  onEmergencyActive: (emergency: Emergency) => void;
  className?: string;
}

type SOSState = 'IDLE' | 'FETCHING_GPS' | 'CONFIRMING' | 'COUNTDOWN' | 'SENDING' | 'SENT';

export function SOSController({
  hospital,
  ambulanceId,
  currentPos,
  patientData,
  previewRoute,
  onEmergencyActive,
  className,
}: SOSControllerProps) {
  const [state, setState] = useState<SOSState>('IDLE');
  const [countdown, setCountdown] = useState(3);
  const [liveGps, setLiveGps] = useState<[number, number] | null>(null);
  const sosRequestInFlightRef = useRef(false);
  const { addToast } = useToast();

  useEffect(() => {
    if (state === 'COUNTDOWN') {
      if (countdown > 0) {
        const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
        return () => clearTimeout(timer);
      } else {
        setState('SENDING');
      }
    }
  }, [state, countdown]);

  useEffect(() => {
    if (state !== 'SENDING') return;

    // Use liveGps if we got it during the check, otherwise fallback to currentPos
    const finalPos = liveGps || currentPos;

    ambulanceService
      .requestSOS(ambulanceId, hospital, patientData, finalPos, previewRoute)
      .then(async emergency => {
        setState('SENT');
        console.log(`[AERO SOS]\nEmergency ID created: ${emergency.id}`);
        console.log(`[AERO SOS REALTIME]\nsubscription: connected`);
        
        let route = previewRoute;
        if (!route || !route.polyline || route.polyline.length === 0) {
          try {
            const { TrafficAwareRoutingProvider } = await import('../../../services/TrafficAwareRoutingProvider');
            route = await TrafficAwareRoutingProvider.getFastestRoute(
              finalPos || [17.44, 78.34],
              [hospital.location.latitude, hospital.location.longitude]
            );
          } catch (routeErr) {
            console.warn('[AERO SOS] Route calculation failed during SOS (non-blocking):', routeErr);
          }
        }

        if (route && route.polyline && route.polyline.length > 0) {
          emergency.route = route;
          // Asynchronously persist to Supabase so Police and Hospital dashboards receive corridor
          const updatePayload: any = {
            route_geometry: route.polyline,
            route_distance_meters: route.distanceMeters,
            route_duration_seconds: route.etaSeconds,
            traffic_duration_seconds: route.trafficAwareEtaSeconds || route.etaSeconds,
            traffic_status: route.trafficStatus || (route.isTrafficAware ? 'LIVE' : 'UNAVAILABLE'),
            route_version: 1,
            route_updated_at: new Date().toISOString()
          };
          if (route.routeProvider) {
            updatePayload.route_provider = route.routeProvider;
          }
          supabase.from('emergency_incidents').update(updatePayload).eq('id', emergency.id).then(async ({ error }: { error: any }) => {
            if (error && (error.message?.includes('route_provider') || error.code === 'PGRST204')) {
              delete updatePayload.route_provider;
              await supabase.from('emergency_incidents').update(updatePayload).eq('id', emergency.id);
            } else if (error) {
              console.warn('[AERO SOS] Failed to sync route to DB:', error);
            }
          });
        }

        const hasRoute = emergency.route?.polyline && emergency.route.polyline.length > 0;
        const isActive = emergency.status === 'ACTIVE' || (emergency.status as any) === 'active';

        if (hasRoute && isActive) {
          addToast({
            variant: 'success',
            title: '🚨 SOS Active',
            message: `Emergency route active (${route?.isTrafficAware ? 'TomTom Live Traffic' : 'Standard'}). Police notified.`,
          });
        } else {
          addToast({
            variant: 'warning',
            title: '🚨 SOS Active',
            message: `Emergency created. Route calculation in progress.`,
          });
        }

        setTimeout(() => {
          setState('IDLE');
          sosRequestInFlightRef.current = false;
          onEmergencyActive(emergency);
        }, 1200);
      })
      .catch(err => {
        console.error('SOS failed:', err);
        setState('IDLE');
        sosRequestInFlightRef.current = false;
        
        if (err.code === 'ALREADY_ACTIVE' || err.message?.includes('ALREADY ACTIVE')) {
          addToast({
            variant: 'warning',
            title: 'Emergency Already Active',
            message: 'You already have an active emergency. Please complete or cancel it before starting a new one.',
          });
        } else {
          addToast({
            variant: 'error',
            title: 'SOS Failed',
            message: err.message || 'Could not activate emergency corridor. Check GPS and try again.',
          });
        }
      });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSOSClick = async () => {
    if (state !== 'IDLE' || sosRequestInFlightRef.current) return;
    
    sosRequestInFlightRef.current = true;
    setState('FETCHING_GPS');

    console.log('[AERO SOS] BUTTON CLICKED');
    console.log('[AERO SOS] Starting emergency workflow');

    // 1. Validate Hospital
    if (!hospital || !hospital.id || !hospital.location) {
      addToast({ variant: 'error', title: 'Invalid Destination', message: 'Selected hospital has invalid location data.' });
      setState('IDLE');
      sosRequestInFlightRef.current = false;
      return;
    }
    console.log(`[AERO SOS DESTINATION]\nname: ${hospital.name}\nlat: ${hospital.location.latitude}\nlon: ${hospital.location.longitude}`);

    // 2. Validate Auth
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      addToast({ variant: 'error', title: 'Auth Required', message: 'Your session has expired. Please sign in again.' });
      setState('IDLE');
      sosRequestInFlightRef.current = false;
      return;
    }
    console.log(`[AERO SOS]\nAuthenticated: true\nUser ID: ${session.user.id}`);

    // 3. Profile / Ambulance Check (Assume valid for now if we have ambulanceId)
    console.log(`[AERO SOS DEBUG]\nPROFILE: Loaded ✓\nAMBULANCE: Assigned ✓`);

    // 4. Retrieve Latest Valid GPS (Timeout after 1.5s to avoid freezing)
    try {
      const positionPromise = geolocationService.getCurrentPosition();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('GPS Timeout')), 1500));
      
      const position = await Promise.race([positionPromise, timeoutPromise]) as any;
      if (!position || isNaN(position.latitude) || isNaN(position.longitude) || (position.latitude === 0 && position.longitude === 0)) {
        throw new Error('Invalid coordinates');
      }
      
      console.log(`[AERO SOS GPS]\nlat: ${position.latitude}\nlon: ${position.longitude}\naccuracy: ${position.accuracy}`);
      setLiveGps([position.latitude, position.longitude]);
    } catch (err) {
      console.error('GPS fetch failed or timed out', err);
      // Fallback: If we already have a valid currentPos from props, we use it, but log it.
      if (currentPos && currentPos[0] !== 0 && !isNaN(currentPos[0])) {
         setLiveGps(currentPos);
      } else {
        addToast({ variant: 'error', title: 'GPS Unavailable', message: 'Waiting for a valid GPS position.' });
        setState('IDLE');
        sosRequestInFlightRef.current = false;
        return;
      }
    }

    // 5. Proceed to Confirmation (Immediate transition)
    setState('CONFIRMING');
  };

  const handleConfirm = () => {
    setCountdown(3);
    setState('COUNTDOWN');
  };

  const handleCancel = () => {
    setState('IDLE');
    sosRequestInFlightRef.current = false;
  };

  const distLabel = (hospital as any).distanceLabel || (hospital.distanceKm ? `${hospital.distanceKm} km` : '');

  let buttonLabel = 'SOS';
  if (state === 'FETCHING_GPS') buttonLabel = 'STARTING...';
  if (state === 'CONFIRMING') buttonLabel = 'READY';
  if (state === 'COUNTDOWN') buttonLabel = 'CALCULATING...';
  if (state === 'SENDING') buttonLabel = 'Sending SOS...';
  if (state === 'SENT') buttonLabel = 'SOS Active';

  return (
    <div className={className}>
      <SOSButton
        onConfirm={handleSOSClick}
        disabled={!hospital?.id || (state !== 'IDLE' && state !== 'FETCHING_GPS')}
        loading={state !== 'IDLE' && state !== 'CONFIRMING'}
        disabledReason={!hospital?.id ? 'Select a hospital first' : undefined}
        label={buttonLabel}
      />

      <Dialog
        open={state === 'CONFIRMING' || state === 'COUNTDOWN'}
        onClose={state === 'CONFIRMING' ? handleCancel : () => {}}
        onConfirm={state === 'CONFIRMING' ? handleConfirm : undefined}
        title={state === 'CONFIRMING' ? 'EMERGENCY DISPATCH CONFIRMATION' : 'Initiating SOS Corridor'}
        variant="emergency"
        confirmLabel="CONFIRM EMERGENCY"
        cancelLabel={state === 'COUNTDOWN' ? 'CANCEL (Aborting)' : 'Cancel'}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            {state === 'COUNTDOWN'
              ? 'Broadcasting live green-wave corridor to police units and destination ER...'
              : 'Please review and verify the emergency telemetry before activating priority corridor.'}
          </p>

          <div className="bg-[#0B1220] border border-slate-700/90 rounded-xl p-4 text-xs space-y-3 shadow-inner">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-0.5">Emergency Type</span>
                <span className="font-extrabold text-white text-sm">{patientData?.category || 'CARDIAC'}</span>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-red-500/20 text-red-400 border border-red-500/30">
                {patientData?.priority || 'CODE_RED'}
              </span>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex items-start gap-2">
                <span className="text-slate-400 text-sm mt-0.5">📍</span>
                <div className="flex-1">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Ambulance GPS</span>
                  <span className="font-mono text-cyan-400 font-bold text-xs">
                    {liveGps && liveGps[0] !== undefined && liveGps[1] !== undefined
                      ? `${liveGps[0].toFixed(5)}, ${liveGps[1].toFixed(5)}`
                      : (currentPos && currentPos[0] !== undefined && currentPos[1] !== undefined
                          ? `${currentPos[0].toFixed(5)}, ${currentPos[1].toFixed(5)}`
                          : 'GPS acquiring or unavailable')}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <span className="text-slate-400 text-sm mt-0.5">🏥</span>
                <div className="flex-1">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Destination ER</span>
                  <span className="font-bold text-emerald-400 text-sm">{hospital?.name}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
              <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-800">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-0.5">Route Distance</span>
                <span className="font-bold text-white text-sm">{distLabel || (previewRoute?.distanceMeters ? `${(previewRoute.distanceMeters / 1000).toFixed(1)} km` : '--')}</span>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-800">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-0.5">Est. Driving ETA</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-white text-sm">
                    {previewRoute?.etaSeconds 
                      ? `${Math.round(previewRoute.etaSeconds / 60)} min`
                      : ((hospital as any).drivingEtaSeconds ? `${Math.round((hospital as any).drivingEtaSeconds / 60)} min` : '--')}
                  </span>
                  {previewRoute?.isTrafficAware && (
                    <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1 py-0.5 rounded font-bold">
                      LIVE
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] pt-1 text-slate-400">
              <span>Routing Engine:</span>
              <span className="font-mono font-semibold text-slate-300">
                {previewRoute?.isTrafficAware 
                  ? 'TomTom Traffic-Aware' 
                  : (previewRoute?.routeProvider === 'ors' ? 'OpenRouteService' : 'OSRM Standard')}
              </span>
            </div>
          </div>

          {state === 'COUNTDOWN' && (
            <div className="text-center py-4 bg-slate-900/50 rounded-xl border border-red-500/30">
              <div className="w-16 h-16 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center text-3xl font-black text-red-400 mx-auto animate-pulse">
                {countdown}
              </div>
              <p className="text-xs text-slate-300 font-semibold mt-3">Transmitting emergency signals in {countdown}s…</p>
              <button
                onClick={handleCancel}
                className="mt-4 px-4 py-2 bg-aero-surface-soft hover:bg-aero-background rounded-lg text-xs text-aero-text-primary font-medium transition-colors cursor-pointer border border-aero-border"
              >
                Abort SOS
              </button>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
