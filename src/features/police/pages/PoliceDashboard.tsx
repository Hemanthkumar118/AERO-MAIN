import { useState, useEffect } from 'react';
import { AppShell } from '../../../components/layout/AppShell';
import {
  MapView,
  AmbulanceMarker,
  HospitalMarker,
  PoliceMarker,
  RoutePolyline,
} from '../../../components/map';
import { Card } from '../../../components/ui/Card';
import { useToast } from '../../../components/ui/Toast';
import { IncomingEmergencyAlert } from '../components/IncomingEmergencyAlert';
import { realtimeService } from '../../../services/realtimeService';
import type { EmergencyIncident } from '../../../types';
import { useLocation } from '../../../hooks/useLocation';
import { supabase } from '../../../lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../../providers/AuthProvider';
import { useRef } from 'react';

export function PoliceDashboard() {
  const { addToast } = useToast();
  const [incidents, setIncidents] = useState<EmergencyIncident[]>([]);
  const { gpsState, location: officerLocation } = useLocation();
  const { profile: policeProfile } = useAuth();
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const notifiedArrivals = useRef<Set<string>>(new Set());

  useEffect(() => {
    let isMounted = true;

    // realtimeService now handles fetching and subscribing to active incidents internally!
    const unsub = realtimeService.on('incidents_updated', (updatedIncidents: EmergencyIncident[]) => {
      if (!isMounted) return;
      setIncidents(updatedIncidents);
    });

    return () => {
      isMounted = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    incidents.forEach(inc => {
      if (inc.status === 'arrived' && !notifiedArrivals.current.has(inc.id)) {
        notifiedArrivals.current.add(inc.id);
        addToast({
          variant: 'success',
          title: 'Ambulance Arrived',
          message: `${inc.ambulance_id || 'Ambulance'} has reached ${inc.destination_hospital || 'the hospital'} safely. Corridor can be closed.`,
          duration: 10000,
        });
      }
    });
  }, [incidents, addToast]);

  const incoming = incidents.filter(i => ['active', 'dispatched', 'en_route'].includes(i.status || '') && !i.police_acknowledged_at);
  const active = incidents.filter(i => ['active', 'dispatched', 'en_route', 'arrived'].includes(i.status || '') && i.police_acknowledged_at);

  const handleAccept = async (emergencyId: string) => {
    const { error } = await supabase.from('emergency_incidents').update({
      police_acknowledged_at: new Date().toISOString(),
      police_id: policeProfile?.id
    }).eq('id', emergencyId);

    if (!error) {
      addToast({
        variant: 'success',
        title: 'Emergency Accepted',
        message: 'You are now coordinating the emergency corridor.',
      });
      setSelectedIncidentId(emergencyId);
    } else {
      addToast({ variant: 'error', title: 'Error', message: 'Could not accept emergency' });
    }
  };

  const handleStatusChange = async (emergencyId: string, status: string) => {
    const { error } = await supabase.from('emergency_incidents').update({
      corridor_status: status
    }).eq('id', emergencyId);

    if (!error) {
      addToast({
        variant: 'success',
        title: 'Corridor Updated',
        message: `Status updated to ${status}.`,
      });
    }
  };



  // Ensure we get connection status updates
  const [connectionState, setConnectionState] = useState(realtimeService.getConnectionState());
  useEffect(() => {
    return realtimeService.on('connection_change', (state) => {
      setConnectionState(state);
    });
  }, []);

  const officerPos: [number, number] = officerLocation
    ? [officerLocation.latitude, officerLocation.longitude || 78.34]
    : [17.44, 78.34]; // Fallback

  const selectedIncident = incidents.find(i => i.id === selectedIncidentId);
  const primaryIncident = selectedIncident || active[0] || incoming[0];

  useEffect(() => {
    if (primaryIncident && primaryIncident.current_latitude && primaryIncident.current_longitude) {
      setMapCenter([primaryIncident.current_latitude, primaryIncident.current_longitude]);
    }
  }, [primaryIncident?.id]);

  if (!policeProfile) {
    return <div className="min-h-dvh bg-bg-main flex items-center justify-center text-text-secondary">Loading Police Terminal...</div>;
  }

  const handleViewDetails = (id: string) => {
    setSelectedIncidentId(id);
    const incident = incidents.find(i => i.id === id);
    if (incident && incident.current_latitude && incident.current_longitude) {
      setMapCenter([incident.current_latitude, incident.current_longitude]);
    }
  };

  return (
    <AppShell
      userRole="POLICE"
      userName={`${policeProfile.full_name || 'Officer'}`}
      connectionState={connectionState}
      gpsState={gpsState}
      gpsAccuracy={officerLocation?.accuracy || 0}
    >
      <div className="flex h-full overflow-hidden bg-bg-main">

        {/* Left Side: Incoming Alerts Panel */}
        <div className="relative z-30 w-[350px] shrink-0 border-r border-border-subtle bg-bg-surface flex flex-col h-full shadow-lg hidden md:flex">
          <div className="p-4 border-b border-border-subtle flex justify-between items-center bg-bg-elevated sticky top-0">
            <h2 className="text-sm font-bold tracking-wider text-white">UPCOMING ALERTS</h2>
            <div className="flex gap-2">
              <div className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#FF3B30]/10 text-[#FF3B30]">
                {incoming.length} LIVE
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            <AnimatePresence mode="popLayout">
              {incoming.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-center text-text-secondary py-12"
                >
                  <p className="font-medium">No incoming emergencies</p>
                  <p className="text-xs mt-1">Listening for SOS alerts...</p>
                </motion.div>
              ) : (
                incoming.map(incident => (
                  <motion.div
                    key={incident.id}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                  >
                    <IncomingEmergencyAlert
                      emergency={incident}
                      hospitalName={incident.destination_hospital || 'Unknown Hospital'}
                      ambulanceName={incident.ambulance_id || 'Ambulance'}
                      onAccept={handleAccept}
                      onViewDetails={handleViewDetails}
                    />
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Center: Live Map Area */}
        <div className="flex-1 relative bg-bg-main h-full min-w-0">
          <MapView center={mapCenter || officerPos} zoom={14} showLiveLocation={true}>
            {/* Police Officer Post */}
            <PoliceMarker
              position={officerPos}
              name={policeProfile?.full_name ?? 'Traffic Police'}
              station="HQ"
              badgeNumber="POL-001"
              availability="AVAILABLE"
            />

            {/* Active Ambulances */}
            {[...incoming, ...active].map(incident => {
              if (!incident.current_latitude || !incident.current_longitude) return null;

              const pos: [number, number] = [incident.current_latitude, incident.current_longitude];
              const dest: [number, number] | null = incident.destination_latitude && incident.destination_longitude
                ? [incident.destination_latitude, incident.destination_longitude]
                : null;

              const isFresh = incident.updated_at ? (new Date().getTime() - new Date(incident.updated_at).getTime() < 60000) : false;

              return (
                <div key={incident.id}>
                  <AmbulanceMarker
                    position={pos}
                    label={incident.ambulance_id || 'Ambulance'}
                    speedKmH={incident.current_speed != null ? incident.current_speed : undefined}
                    isSOS={true}
                    emergencyId={incident.id}
                    status={isFresh ? 'LIVE' : 'STALE'}
                    eta={(incident.traffic_duration_seconds || incident.route_duration_seconds) != null ? `${Math.round((incident.traffic_duration_seconds || incident.route_duration_seconds!) / 60)} min` : 'UNAVAILABLE'}
                    destination={incident.destination_hospital || 'Unknown'}
                    updatedAt={incident.updated_at || new Date().toISOString()}
                  />
                  {dest && (
                    <HospitalMarker
                      position={dest}
                      name={incident.destination_hospital || 'Hospital'}
                    />
                  )}
                  {incident.route_geometry && (
                    <RoutePolyline positions={incident.route_geometry} active={true} />
                  )}
                </div>
              );
            })}
          </MapView>

          {/* Overlay Status Bar */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-3 z-30 pointer-events-none">
            <div className="bg-bg-elevated/90 backdrop-blur-md px-4 py-2 rounded-full border border-border-subtle shadow-lg flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#20D67A] animate-pulse"></div>
              <span className="text-xs font-bold text-white tracking-wider">LIVE MAP</span>
            </div>
            <div className="bg-bg-elevated/90 backdrop-blur-md px-4 py-2 rounded-full border border-border-subtle shadow-lg flex items-center gap-2">
              <span className="text-xs font-bold text-text-secondary tracking-wider">ACTIVE EMERGENCIES:</span>
              <span className="text-xs font-bold text-white">{incidents.length}</span>
            </div>
          </div>
        </div>

        {/* Right Side: Active Corridors Panel */}
        <div className="relative z-30 w-[350px] shrink-0 bg-bg-surface border-l border-border-subtle flex flex-col h-full shadow-lg hidden lg:flex">
          <div className="p-4 border-b border-border-subtle flex justify-between items-center bg-bg-elevated sticky top-0">
            <h2 className="text-sm font-bold tracking-wider text-white">ACTIVE CORRIDORS</h2>
            <div className="flex gap-2 items-center">
              <button
                onClick={async () => {
                  if (confirm('Wipe all active emergencies?')) {
                    await supabase.from('emergency_incidents').update({ status: 'cancelled' }).in('status', ['active', 'dispatched', 'en_route', 'arrived']);
                    setIncidents([]);
                  }
                }}
                className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#FF3B30] text-white hover:bg-white hover:text-[#FF3B30] transition-colors"
              >
                NUKE ALL
              </button>
              <div className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#35C7FF]/10 text-[#35C7FF]">
                {active.length} ACTIVE
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <AnimatePresence mode="popLayout">
              {active.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-center text-text-secondary py-12"
                >
                  <div className="w-12 h-12 rounded-full bg-bg-elevated flex items-center justify-center mx-auto mb-3 border border-border-subtle shadow-inner">
                    <svg className="w-6 h-6 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <p className="font-medium text-white">No active emergencies.</p>
                  <p className="text-sm mt-1">Standby for incoming requests.</p>
                </motion.div>
              ) : (
                active.map(incident => (
                  <motion.div
                    key={incident.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    onClick={() => handleViewDetails(incident.id)}
                    className={`cursor-pointer transition-all ${selectedIncidentId === incident.id ? 'ring-2 ring-[#35C7FF]' : ''}`}
                  >
                    <Card className="enterprise-card border-[#35C7FF]/30 hover:border-[#35C7FF]/60">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h3 className="font-bold text-white text-lg">{incident.ambulance_id || 'Ambulance'}</h3>
                          <p className="text-xs text-[#FF3B30] font-bold bg-[#FF3B30]/10 inline-block px-2 py-0.5 rounded-full mt-1 border border-[#FF3B30]/20">
                            {incident.priority?.toUpperCase() || 'HIGH'}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-[#35C7FF] font-mono">
                            {(incident.traffic_duration_seconds || incident.route_duration_seconds) != null ? Math.round((incident.traffic_duration_seconds || incident.route_duration_seconds!) / 60) : <span className="text-lg">UNAVAILABLE</span>}
                            {(incident.traffic_duration_seconds || incident.route_duration_seconds) != null && <span className="text-sm text-[#35C7FF]/70 ml-1">min</span>}
                          </div>
                          <p className="telemetry-label mt-0.5">ETA</p>
                        </div>
                      </div>

                      <div className="space-y-2 mb-4 text-sm bg-bg-main rounded-lg p-3 border border-border-subtle">
                        <div className="flex justify-between items-center">
                          <span className="telemetry-label">Destination</span>
                          <span className="text-white font-medium truncate max-w-[150px]" title={incident.destination_hospital || ''}>
                            {incident.destination_hospital || 'Unknown'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="telemetry-label">Distance</span>
                          <span className="text-[#20D67A] font-mono font-medium">
                            {incident.route_distance_meters != null ? `${(incident.route_distance_meters / 1000).toFixed(1)} km` : 'UNAVAILABLE'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="telemetry-label">Speed</span>
                          <span className="text-[#35C7FF] font-mono font-medium">
                            {incident.current_speed != null ? `${Math.round(incident.current_speed)} km/h` : 'UNAVAILABLE'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="telemetry-label">GPS Status</span>
                          <span className={`font-mono font-bold ${incident.updated_at && (new Date().getTime() - new Date(incident.updated_at).getTime() < 60000)
                              ? 'text-[#20D67A]' : 'text-[#FFB020]'
                            }`}>
                            {incident.updated_at && (new Date().getTime() - new Date(incident.updated_at).getTime() < 60000)
                              ? 'LIVE' : 'STALE'}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-3" onClick={e => e.stopPropagation()}>
                        <p className="telemetry-label">Corridor Actions</p>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            className={`font-bold py-2 rounded-lg text-xs transition-colors border ${incident.corridor_status === 'CLEAR'
                                ? 'bg-[#20D67A] text-bg-main border-[#20D67A]'
                                : 'bg-[#20D67A]/10 hover:bg-[#20D67A]/20 text-[#20D67A] border-[#20D67A]/30'
                              }`}
                            onClick={() => handleStatusChange(incident.id, 'CLEAR')}
                          >
                            CLEAR
                          </button>
                          <button
                            className={`font-bold py-2 rounded-lg text-xs transition-colors border ${incident.corridor_status === 'CLEARING'
                                ? 'bg-[#35C7FF] text-bg-main border-[#35C7FF]'
                                : 'bg-[#35C7FF]/10 hover:bg-[#35C7FF]/20 text-[#35C7FF] border-[#35C7FF]/30'
                              }`}
                            onClick={() => handleStatusChange(incident.id, 'CLEARING')}
                          >
                            CLEARING
                          </button>
                          <button
                            className={`font-bold py-2 rounded-lg text-xs transition-colors border ${incident.corridor_status === 'CAUTION'
                                ? 'bg-[#FFB020] text-bg-main border-[#FFB020]'
                                : 'bg-[#FFB020]/10 hover:bg-[#FFB020]/20 text-[#FFB020] border-[#FFB020]/30'
                              }`}
                            onClick={() => handleStatusChange(incident.id, 'CAUTION')}
                          >
                            CAUTION
                          </button>
                          <button
                            className={`font-bold py-2 rounded-lg text-xs transition-colors border ${incident.corridor_status === 'BLOCKED'
                                ? 'bg-[#FF3B30] text-bg-main border-[#FF3B30]'
                                : 'bg-[#FF3B30]/10 hover:bg-[#FF3B30]/20 text-[#FF3B30] border-[#FF3B30]/30'
                              }`}
                            onClick={() => handleStatusChange(incident.id, 'BLOCKED')}
                          >
                            BLOCKED
                          </button>
                        </div>
                        <p className="text-[11px] text-center text-text-secondary mt-2">
                          Current Status: <strong className="text-white">{incident.corridor_status || 'PENDING'}</strong>
                        </p>
                      </div>
                    </Card>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

      </div>
    </AppShell>
  );
}




