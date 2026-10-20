import { useState, useEffect, useRef } from 'react';
import { AppShell } from '../../../components/layout/AppShell';
import {
  MapView,
  AmbulanceMarker,
  HospitalMarker,
  PoliceMarker,
  RoutePolyline,
} from '../../../components/map';
import { useToast } from '../../../components/ui/Toast';
import { IncomingEmergencyAlert } from '../components/IncomingEmergencyAlert';
import { realtimeService } from '../../../services/realtimeService';
import type { EmergencyIncident } from '../../../types';
import { useLocation } from '../../../hooks/useLocation';
import { supabase } from '../../../lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../../providers/AuthProvider';
import { 
  Shield, 
  CheckCircle2, 
  Map as MapIcon, 
  Radio
} from 'lucide-react';

export function PoliceDashboard() {
  const { addToast } = useToast();
  const [incidents, setIncidents] = useState<EmergencyIncident[]>([]);
  const { gpsState, location: officerLocation } = useLocation();
  const { profile: policeProfile } = useAuth();
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [activeTabMobile, setActiveTabMobile] = useState<'map' | 'alerts' | 'corridors'>('map');
  const notifiedArrivals = useRef<Set<string>>(new Set());

  useEffect(() => {
    let isMounted = true;

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
    try {
      const { error } = await supabase.from('emergency_incidents').update({
        police_acknowledged_at: new Date().toISOString(),
        police_id: policeProfile?.id
      }).eq('id', emergencyId);

      if (error) throw error;

      addToast({
        variant: 'success',
        title: 'Emergency Accepted',
        message: 'You are now actively coordinating priority green-wave clearance.',
      });
      setSelectedIncidentId(emergencyId);
    } catch (err: any) {
      addToast({ variant: 'error', title: 'Action Failed', message: err.message || 'Could not accept emergency' });
    }
  };

  const handleStatusChange = async (emergencyId: string, status: string) => {
    try {
      // Optimistic local update
      setIncidents(prev => prev.map(inc => inc.id === emergencyId ? { ...inc, corridor_status: status as any } : inc));

      const { error } = await supabase.from('emergency_incidents').update({
        corridor_status: status
      }).eq('id', emergencyId);

      if (error) throw error;

      addToast({
        variant: 'success',
        title: 'Corridor Status Confirmed',
        message: `Traffic corridor state updated to ${status}.`,
      });
    } catch (err: any) {
      addToast({ variant: 'error', title: 'Update Failed', message: err.message || 'Could not update corridor status' });
      // Revert on error
      const { data } = await supabase.from('emergency_incidents').select('*').eq('id', emergencyId).single();
      if (data) {
        setIncidents(prev => prev.map(inc => inc.id === emergencyId ? data : inc));
      }
    }
  };

  const [connectionState, setConnectionState] = useState(realtimeService.getConnectionState());
  useEffect(() => {
    return realtimeService.on('connection_change', (state) => {
      setConnectionState(state);
    });
  }, []);

  const officerPos: [number, number] | null = officerLocation
    ? [officerLocation.latitude, officerLocation.longitude]
    : null;

  const selectedIncident = incidents.find(i => i.id === selectedIncidentId);
  const primaryIncident = selectedIncident || active[0] || incoming[0];

  useEffect(() => {
    if (primaryIncident && primaryIncident.current_latitude && primaryIncident.current_longitude) {
      setMapCenter([primaryIncident.current_latitude, primaryIncident.current_longitude]);
    }
  }, [primaryIncident?.id]);

  const handleViewDetails = (id: string) => {
    setSelectedIncidentId(id);
    const incident = incidents.find(i => i.id === id);
    if (incident && incident.current_latitude && incident.current_longitude) {
      setMapCenter([incident.current_latitude, incident.current_longitude]);
    }
    // Switch to map view on mobile if clicked from list
    setActiveTabMobile('map');
  };

  return (
    <AppShell
      userRole="POLICE"
      userName={policeProfile?.full_name ? `Officer ${policeProfile.full_name}` : 'Traffic Police Officer'}
      connectionState={connectionState}
      gpsState={gpsState}
      gpsAccuracy={officerLocation?.accuracy || 0}
    >
      <div className="flex flex-col h-full overflow-hidden bg-[#07090C] text-slate-200">
        
        {/* Mobile View Toggle Bar (visible only on mobile/tablet) */}
        <div className="lg:hidden flex items-center justify-around bg-[#0D111A] border-b border-slate-800 px-2 py-1.5 shrink-0 z-40">
          <button
            onClick={() => setActiveTabMobile('map')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTabMobile === 'map'
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span>Map View</span>
          </button>

          <button
            onClick={() => setActiveTabMobile('alerts')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer relative ${
              activeTabMobile === 'alerts'
                ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Alerts</span>
            {incoming.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
                {incoming.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTabMobile('corridors')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer relative ${
              activeTabMobile === 'corridors'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Active Corridors</span>
            {active.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-emerald-500 text-black text-[10px] flex items-center justify-center font-black">
                {active.length}
              </span>
            )}
          </button>
        </div>

        {/* Main Workspace: 3-column on Desktop, Active Tab on Mobile */}
        <div className="flex-1 flex overflow-hidden relative">

          {/* Left Column: Incoming Emergency Alerts */}
          <div className={`relative z-30 w-full lg:w-[360px] shrink-0 border-r border-slate-800 bg-[#0D111A] flex flex-col h-full shadow-xl ${
            activeTabMobile === 'alerts' ? 'flex' : 'hidden lg:flex'
          }`}>
            <div className="p-3.5 border-b border-slate-800 flex justify-between items-center bg-[#131826] sticky top-0">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-red-400 animate-pulse" />
                <h2 className="text-xs font-bold tracking-wider text-white uppercase">INCOMING SOS ALERTS</h2>
              </div>
              <div className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                {incoming.length} PENDING
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
              <AnimatePresence mode="popLayout">
                {incoming.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center text-slate-400 py-16 px-4"
                  >
                    <div className="w-12 h-12 rounded-full bg-[#131826] border border-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-500">
                      <Radio className="w-6 h-6" />
                    </div>
                    <p className="font-semibold text-white text-sm">No pending emergency alerts</p>
                    <p className="text-xs text-slate-400 mt-1">Listening for authorized ambulance SOS signals...</p>
                  </motion.div>
                ) : (
                  incoming.map(incident => (
                    <motion.div
                      key={incident.id}
                      layout
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -16 }}
                    >
                      <IncomingEmergencyAlert
                        emergency={incident}
                        hospitalName={incident.destination_hospital || 'Hospital'}
                        ambulanceName={incident.ambulance_id || 'Ambulance Unit'}
                        onAccept={handleAccept}
                        onViewDetails={handleViewDetails}
                      />
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Center Column: Live Tactical Map */}
          <div className={`flex-1 relative bg-slate-900 h-full min-w-0 ${
            activeTabMobile === 'map' ? 'flex flex-col' : 'hidden lg:flex lg:flex-col'
          }`}>
            <MapView 
              center={mapCenter || officerPos || [17.44, 78.34]} 
              zoom={14} 
              showLiveLocation={false}
            >
              {/* Authenticated Police Post Marker (only if real GPS available) */}
              {officerPos && (
                <PoliceMarker
                  position={officerPos}
                  name={policeProfile?.full_name ? `Officer ${policeProfile.full_name}` : 'Traffic Police Officer'}
                  station={policeProfile?.organization || 'Traffic Division'}
                  badgeNumber={(policeProfile as any)?.badge_number || 'AERO-TP'}
                  availability="AVAILABLE"
                />
              )}

              {/* Active Ambulances with Authentic GPS */}
              {[...incoming, ...active].map(incident => {
                if (!incident.current_latitude || !incident.current_longitude) return null;

                const pos: [number, number] = [incident.current_latitude, incident.current_longitude];
                const dest: [number, number] | null = incident.destination_latitude && incident.destination_longitude
                  ? [incident.destination_latitude, incident.destination_longitude]
                  : null;

                const isFresh = incident.updated_at 
                  ? (new Date().getTime() - new Date(incident.updated_at).getTime() < 60000) 
                  : false;

                return (
                  <div key={incident.id}>
                    <AmbulanceMarker
                      position={pos}
                      label={incident.ambulance_id || 'Ambulance'}
                      speedKmH={incident.current_speed != null ? incident.current_speed : undefined}
                      isSOS={true}
                      emergencyId={incident.id}
                      status={isFresh ? 'LIVE' : 'STALE'}
                      eta={incident.traffic_duration_seconds != null 
                        ? `${Math.round(incident.traffic_duration_seconds / 60)} min (TomTom Live)` 
                        : (incident.route_duration_seconds != null ? `${Math.round(incident.route_duration_seconds / 60)} min` : 'UNAVAILABLE')}
                      destination={incident.destination_hospital || 'Hospital'}
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

            {/* Tactical Status Overlay Bar */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-2.5 z-30 pointer-events-none flex-wrap justify-center px-2">
              <div className="bg-[#0D111A]/90 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-slate-700 shadow-xl flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-[11px] font-bold text-white tracking-wider uppercase">POLICE TACTICAL RADAR</span>
              </div>
              <div className="bg-[#0D111A]/90 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-slate-700 shadow-xl flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase">ACTIVE EMERGENCIES:</span>
                <span className="text-[11px] font-mono font-bold text-cyan-400">{incidents.length}</span>
              </div>
            </div>
          </div>

          {/* Right Column: Active Corridors Panel */}
          <div className={`relative z-30 w-full lg:w-[380px] shrink-0 bg-[#0D111A] border-l border-slate-800 flex flex-col h-full shadow-xl ${
            activeTabMobile === 'corridors' ? 'flex' : 'hidden lg:flex'
          }`}>
            <div className="p-3.5 border-b border-slate-800 flex justify-between items-center bg-[#131826] sticky top-0">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-cyan-400" />
                <h2 className="text-xs font-bold tracking-wider text-white uppercase">ACTIVE GREEN-WAVE CORRIDORS</h2>
              </div>
              <div className="px-2 py-0.5 rounded-full text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                {active.length} COORDINATED
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 custom-scrollbar">
              <AnimatePresence mode="popLayout">
                {active.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center text-slate-400 py-16 px-4"
                  >
                    <div className="w-12 h-12 rounded-full bg-[#131826] border border-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-500">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <p className="font-semibold text-white text-sm">No active priority corridors</p>
                    <p className="text-xs text-slate-400 mt-1">Accept incoming emergencies on the left to initiate green-wave coordination.</p>
                  </motion.div>
                ) : (
                  active.map(incident => {
                    const isSelected = selectedIncidentId === incident.id;
                    const isFresh = incident.updated_at 
                      ? (new Date().getTime() - new Date(incident.updated_at).getTime() < 60000) 
                      : false;

                    return (
                      <motion.div
                        key={incident.id}
                        layout
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        onClick={() => handleViewDetails(incident.id)}
                        className={`cursor-pointer transition-all rounded-xl border ${
                          isSelected 
                            ? 'bg-[#131826] border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.15)]' 
                            : 'bg-[#0F141F] border-slate-800 hover:border-slate-700'
                        } p-3.5`}
                      >
                        <div className="flex justify-between items-start mb-2.5">
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-white text-base leading-tight">
                                {incident.ambulance_id || 'Ambulance Unit'}
                              </h3>
                              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                incident.priority === 'CRITICAL' || incident.priority === 'critical'
                                  ? 'bg-red-500/10 text-red-400 border-red-500/30'
                                  : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                              }`}>
                                {incident.priority || 'HIGH'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 truncate mt-0.5">
                              → <strong className="text-emerald-400">{incident.destination_hospital || 'Hospital'}</strong>
                            </p>
                          </div>

                          <div className="text-right">
                            <div className="text-xl font-black text-cyan-300 font-mono tracking-tight">
                              {incident.traffic_duration_seconds != null
                                ? Math.round(incident.traffic_duration_seconds / 60)
                                : (incident.route_duration_seconds != null ? Math.round(incident.route_duration_seconds / 60) : '--')}
                              <span className="text-xs text-cyan-500/80 ml-1">min</span>
                            </div>
                            <p className="text-[10px] text-slate-500 uppercase font-bold">ESTIMATED ETA</p>
                          </div>
                        </div>

                        {/* Telemetry Strip */}
                        <div className="grid grid-cols-3 gap-2 bg-[#07090C] rounded-lg p-2.5 border border-slate-800/80 mb-3 text-[11px]">
                          <div>
                            <span className="text-[9px] text-slate-500 uppercase font-bold block">Distance</span>
                            <span className="text-slate-200 font-mono font-bold">
                              {incident.route_distance_meters != null ? `${(incident.route_distance_meters / 1000).toFixed(1)} km` : 'N/A'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[9px] text-slate-500 uppercase font-bold block">Speed</span>
                            <span className="text-cyan-300 font-mono font-bold">
                              {incident.current_speed != null ? `${Math.round(incident.current_speed)} km/h` : 'N/A'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[9px] text-slate-500 uppercase font-bold block">GPS Fix</span>
                            <span className={`font-mono font-bold text-[10px] ${isFresh ? 'text-emerald-400' : 'text-amber-400'}`}>
                              {isFresh ? 'LIVE' : 'STALE'}
                            </span>
                          </div>
                        </div>

                        {/* Corridor Action Buttons */}
                        <div className="space-y-2" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                              Corridor Action
                            </span>
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                              incident.corridor_status === 'CLEAR' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
                              incident.corridor_status === 'CLEARING' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40' :
                              incident.corridor_status === 'CAUTION' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                              incident.corridor_status === 'BLOCKED' ? 'bg-red-500/20 text-red-400 border-red-500/40' :
                              'bg-slate-800 text-slate-400 border-slate-700'
                            }`}>
                              Status: {incident.corridor_status || 'PENDING'}
                            </span>
                          </div>

                          <div className="grid grid-cols-4 gap-1.5">
                            <button
                              className={`font-bold py-1.5 rounded-lg text-xs transition-colors border cursor-pointer ${
                                incident.corridor_status === 'CLEAR'
                                  ? 'bg-emerald-500 text-black border-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                              }`}
                              onClick={() => handleStatusChange(incident.id, 'CLEAR')}
                              title="Confirm corridor is clear for priority transport"
                            >
                              CLEAR
                            </button>
                            <button
                              className={`font-bold py-1.5 rounded-lg text-xs transition-colors border cursor-pointer ${
                                incident.corridor_status === 'CLEARING'
                                  ? 'bg-cyan-500 text-black border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.5)]'
                                  : 'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                              }`}
                              onClick={() => handleStatusChange(incident.id, 'CLEARING')}
                              title="Police units actively clearing junctions"
                            >
                              CLEARING
                            </button>
                            <button
                              className={`font-bold py-1.5 rounded-lg text-xs transition-colors border cursor-pointer ${
                                incident.corridor_status === 'CAUTION'
                                  ? 'bg-amber-500 text-black border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                                  : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                              }`}
                              onClick={() => handleStatusChange(incident.id, 'CAUTION')}
                              title="Traffic slowdown or bottlenecks reported"
                            >
                              CAUTION
                            </button>
                            <button
                              className={`font-bold py-1.5 rounded-lg text-xs transition-colors border cursor-pointer ${
                                incident.corridor_status === 'BLOCKED'
                                  ? 'bg-red-500 text-white border-red-400 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                                  : 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/30'
                              }`}
                              onClick={() => handleStatusChange(incident.id, 'BLOCKED')}
                              title="Corridor blocked by incident or obstruction"
                            >
                              BLOCKED
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>
            </div>
          </div>

        </div>

      </div>
    </AppShell>
  );
}
