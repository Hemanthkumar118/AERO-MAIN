import { useState, useEffect } from 'react';
import { realtimeService } from '../../services/realtimeService';
import { useAuth } from '../../providers/AuthProvider';
import type { Emergency } from '../../types';

export function GlobalEmergencyBanner({ userRole, userName }: { userRole?: string, userName?: string }) {
  const [activeEmergency, setActiveEmergency] = useState<Emergency | null>(null);
  const { profile } = useAuth();

  const role = (userRole || profile?.role)?.toUpperCase();
  const isAmbulance = role === 'AMBULANCE' || role === 'AMBULANCE_OPERATOR';

  useEffect(() => {
    const unsubscribe = realtimeService.on('incidents_updated', (incidents: any[]) => {
      const active = incidents.find(i => {
        const isActiveState = i.status === 'active' || i.status === 'dispatched' || i.status === 'en_route';
        if (!isActiveState) return false;
        
        if (role === 'HOSPITAL' || role === 'HOSPITAL_ER') {
          return i.destination_hospital === userName;
        }
        return true;
      });
      if (active) {
        setActiveEmergency({
          id: active.id,
          status: 'ACTIVE',
          priority: active.priority || 'CODE_RED',
          ambulanceId: active.ambulance_id || 'AMB-1',
          ambulanceDisplayName: active.ambulance_id || 'AERO ALS',
          hospital: { name: active.destination_hospital || 'Hospital', id: '', address: '', location: { latitude: 0, longitude: 0 }, emergencyCapable: true },
          patient: {
            name: active.patient_name || 'Emergency Patient',
            category: active.incident_type || 'GENERAL',
            priority: active.priority || 'CODE_RED',
            chiefComplaint: active.description || 'Emergency dispatch',
            vitals: { heartRate: 0, bloodPressure: '--/--', spo2: 0, respiratoryRate: 0, gcsScore: 0 } // Live vitals not implemented in DB yet
          },
          currentSpeedKmH: active.current_speed || 0,
          route: {
            etaSeconds: active.route_duration_seconds || 0,
            polyline: active.route_geometry || [],
            distanceMeters: active.route_distance_meters || 0
          },
          vehicleNumber: active.ambulance_id || 'AMB-1',
          createdAt: active.created_at
        });
      } else {
        setActiveEmergency(null);
      }
    });

    return () => unsubscribe();
  }, []);

  if (isAmbulance || !activeEmergency || activeEmergency.status === 'COMPLETED' || activeEmergency.status === 'CANCELLED') {
    return null;
  }

  const etaMins = Math.round((activeEmergency.route?.etaSeconds || 0) / 60);

  return (
    <div className="bg-[#FF3B30]/10 border-b border-[#FF3B30]/30 px-4 py-2 flex items-center justify-between shadow-lg z-50 text-xs shrink-0">
      <div className="flex items-center gap-3">
        <span className="w-2.5 h-2.5 rounded-full bg-[#FF3B30] animate-ping shrink-0" />
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-[#FF3B30] tracking-wider uppercase">
            LIVE EMERGENCY ({activeEmergency.id})
          </span>
          <span className="text-[#FF3B30]/60 hidden sm:inline">•</span>
          <span className="text-text-primary font-medium">
            {activeEmergency.ambulanceDisplayName} → {activeEmergency.hospital.name}
          </span>
          <span className="bg-[#FF3B30]/20 text-[#FF3B30] px-2 py-0.5 rounded font-mono font-bold">
            {activeEmergency.priority || 'CODE_RED'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <div className="text-right hidden sm:block">
          <span className="text-text-secondary block text-[10px]">CURRENT ETA</span>
          <span className="text-[#FF3B30] font-bold font-mono text-sm">{etaMins > 0 ? `${etaMins} MINS` : '--'}</span>
        </div>
        <div className="text-right">
          <span className="text-text-secondary block text-[10px]">SPEED</span>
          <span className="text-[#20D67A] font-bold font-mono text-sm">{(activeEmergency.currentSpeedKmH || 0) > 0 ? `${Math.round(activeEmergency.currentSpeedKmH || 0)} km/h` : '0 km/h'}</span>
        </div>
      </div>
    </div>
  );
}
