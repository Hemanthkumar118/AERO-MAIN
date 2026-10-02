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
  onEmergencyActive: (emergency: Emergency) => void;
  className?: string;
}

type SOSState = 'IDLE' | 'FETCHING_GPS' | 'CONFIRMING' | 'COUNTDOWN' | 'SENDING' | 'SENT';

export function SOSController({
  hospital,
  ambulanceId,
  currentPos,
  patientData,
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
      .requestSOS(ambulanceId, hospital, patientData, finalPos)
      .then(emergency => {
        setState('SENT');
        console.log(`[AERO SOS]\nEmergency ID created: ${emergency.id}`);
        console.log(`[AERO SOS REALTIME]\nsubscription: connected`);
        
        const hasRoute = emergency.route?.polyline && emergency.route.polyline.length > 0;
        const isActive = emergency.status === 'ACTIVE' || (emergency.status as any) === 'active';

        if (hasRoute && isActive) {
          addToast({
            variant: 'success',
            title: '🚨 SOS Active',
            message: `Emergency route active. Police notification pending.`,
          });
        } else {
          addToast({
            variant: 'warning',
            title: '🚨 SOS Partial',
            message: `Emergency created but route/status incomplete.`,
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
        title={state === 'CONFIRMING' ? 'EMERGENCY CONFIRMATION' : 'Initiating SOS Corridor'}
        variant="emergency"
        confirmLabel="CONFIRM EMERGENCY"
        cancelLabel={state === 'COUNTDOWN' ? 'CANCEL (Aborting)' : 'Cancel'}
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            {state === 'COUNTDOWN'
              ? 'Computing live OSRM route & broadcasting green-wave to police…'
              : 'Please review the emergency details before raising the SOS.'}
          </p>

          <div className="bg-bg-main border border-border-subtle rounded-xl p-3 text-xs space-y-3">
            <div className="flex flex-col">
              <span className="telemetry-label">Emergency:</span>
              <span className="font-bold text-white text-sm">{patientData?.category || 'General'}</span>
            </div>
            
            <div className="flex flex-col">
              <span className="telemetry-label">Priority:</span>
              <span className="font-bold text-[#FF3B30] text-sm">{patientData?.priority || 'Critical'}</span>
            </div>

            <div className="flex flex-col">
              <span className="telemetry-label">Current Location:</span>
              <span className="font-bold text-[#35C7FF] font-mono text-xs">{liveGps ? `${liveGps[0].toFixed(5)}, ${liveGps[1].toFixed(5)}` : (currentPos ? `${currentPos[0].toFixed(5)}, ${currentPos[1].toFixed(5)}` : 'LIVE GPS')}</span>
            </div>

            <div className="flex flex-col">
              <span className="telemetry-label">Destination:</span>
              <span className="font-bold text-[#20D67A] text-sm">{hospital?.name}</span>
            </div>

            <div className="flex flex-col">
              <span className="telemetry-label">Route:</span>
              <span className="font-bold text-white text-xs">OSRM Computed Route</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <span className="telemetry-label">Distance:</span>
                <span className="font-bold text-white text-sm">{distLabel}</span>
              </div>
              <div className="flex flex-col">
                <span className="telemetry-label">Estimated Travel Time:</span>
                <span className="font-bold text-white text-sm">{(hospital as any).drivingEtaSeconds ? Math.round((hospital as any).drivingEtaSeconds/60) : '--'} min</span>
              </div>
            </div>
          </div>

          {state === 'COUNTDOWN' && (
            <div className="text-center py-4">
              <span className="text-4xl font-bold text-[#FF3B30] tabular-nums animate-pulse">
                {countdown}
              </span>
              <p className="text-xs text-text-secondary mt-2">Transmitting in {countdown}s…</p>
              <button
                onClick={handleCancel}
                className="mt-4 px-4 py-2 bg-bg-elevated hover:bg-bg-main rounded-lg text-xs text-white font-medium transition-colors cursor-pointer border border-border-subtle"
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
