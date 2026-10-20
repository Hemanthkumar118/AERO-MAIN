import { useState, useEffect, useRef, useCallback } from 'react';
import { AppShell } from '../../../components/layout/AppShell';
import {
  MapView,
  AmbulanceMarker,
  HospitalMarker,
  PoliceMarker,
  RoutePolyline,
  JunctionMarker,
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
  Radio,
  Navigation
} from 'lucide-react';
import { Dialog } from '../../../components/ui/Dialog';
import {
  policeCoordinationService,
  type PoliceRouteAssignment,
  type PoliceRouteAssignmentStatus
} from '../../../services/policeCoordinationService';

export function PoliceDashboard() {
  const { addToast } = useToast();
  const [incidents, setIncidents] = useState<EmergencyIncident[]>([]);
  const { gpsState, location: officerLocation } = useLocation();
  const { profile: policeProfile } = useAuth();
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [activeTabMobile, setActiveTabMobile] = useState<'map' | 'alerts' | 'corridors'>('map');
  const notifiedArrivals = useRef<Set<string>>(new Set());

  // Modal dialog states for state machine transitions
  const [blockageModalOpen, setBlockageModalOpen] = useState(false);
  const [selectedAssignmentForBlockage, setSelectedAssignmentForBlockage] = useState<PoliceRouteAssignment | null>(null);
  const [blockageNotes, setBlockageNotes] = useState('');

  const [declineModalOpen, setDeclineModalOpen] = useState(false);
  const [selectedAssignmentForDecline, setSelectedAssignmentForDecline] = useState<PoliceRouteAssignment | null>(null);
  const [declineReason, setDeclineReason] = useState('UNAVAILABLE_OTHER_EMERGENCY');

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

  // Route Coordination Engine State
  const [routeAssignmentsByIncident, setRouteAssignmentsByIncident] = useState<Record<string, PoliceRouteAssignment[]>>({});
  const [isTransitioningStatus, setIsTransitioningStatus] = useState<string | null>(null);

  // Fetch or generate route coordination plan for an incident
  const loadIncidentPlan = useCallback(async (incidentId: string) => {
    try {
      const planData = await policeCoordinationService.getPlan(incidentId);
      if (planData?.assignments) {
        setRouteAssignmentsByIncident(prev => ({
          ...prev,
          [incidentId]: planData.assignments
        }));
      }
    } catch {
      // If plan not yet generated, attempt to generate using route geometry
      const inc = incidents.find(i => i.id === incidentId);
      if (inc && inc.route_geometry && Array.isArray(inc.route_geometry) && inc.route_geometry.length > 1) {
        try {
          const ambLat = inc.current_latitude || inc.latitude || 17.44;
          const ambLon = inc.current_longitude || inc.longitude || 78.34;
          const genResult = await policeCoordinationService.generatePlan(incidentId, {
            routePolyline: inc.route_geometry,
            routeDistanceMeters: inc.route_distance_meters || undefined,
            routeDurationSeconds: inc.route_duration_seconds || undefined,
            ambulanceLocation: [ambLat, ambLon],
            emergencyPriority: inc.priority || 'CODE_RED'
          });
          if (genResult?.assignments) {
            setRouteAssignmentsByIncident(prev => ({
              ...prev,
              [incidentId]: genResult.assignments
            }));
          }
        } catch (genErr) {
          console.warn('[PoliceDashboard] Could not generate route plan:', genErr);
        }
      }
    }
  }, [incidents]);

  // Load plans whenever incidents change
  useEffect(() => {
    incidents.forEach(inc => {
      if (['active', 'dispatched', 'en_route'].includes(inc.status || '')) {
        loadIncidentPlan(inc.id);
      }
    });
  }, [incidents, loadIncidentPlan]);

  // Realtime subscription for police_assignment_updated
  useEffect(() => {
    const unsub = realtimeService.on('police_assignment_updated', (updatedAsg: PoliceRouteAssignment) => {
      if (!updatedAsg || !updatedAsg.incident_id) return;
      setRouteAssignmentsByIncident(prev => {
        const currentList = prev[updatedAsg.incident_id] || [];
        const idx = currentList.findIndex(a => a.id === updatedAsg.id);
        let updatedList: PoliceRouteAssignment[];
        if (idx >= 0) {
          updatedList = [...currentList];
          updatedList[idx] = updatedAsg;
        } else {
          updatedList = [...currentList, updatedAsg].sort((a, b) => a.sequence_order - b.sequence_order);
        }
        return {
          ...prev,
          [updatedAsg.incident_id]: updatedList
        };
      });

      // Notify if assigned to this officer and status is NOTIFIED
      if (updatedAsg.police_id === policeProfile?.id && updatedAsg.status === 'NOTIFIED') {
        addToast({
          variant: 'warning',
          title: '🚨 Advance Route Alert',
          message: `Assigned Checkpoint Ahead: ${updatedAsg.junction_name} (ETA ~${Math.round(updatedAsg.distance_from_ambulance_meters / 1000)}km away)`,
          duration: 9000
        });
      }
    });

    return () => {
      unsub();
    };
  }, [policeProfile?.id, addToast]);

  const handleCheckpointStatusTransition = async (
    assignmentId: string,
    newStatus: PoliceRouteAssignmentStatus,
    meta: { trafficCondition?: any; reason?: string; rejectionReason?: string; blockageDetails?: string; notes?: string } = {}
  ) => {
    setIsTransitioningStatus(assignmentId);
    try {
      const res = await policeCoordinationService.updateAssignmentStatus(assignmentId, newStatus, meta);
      if (res?.assignment) {
        setRouteAssignmentsByIncident(prev => {
          const incId = res.assignment.incident_id;
          const currentList = prev[incId] || [];
          return {
            ...prev,
            [incId]: currentList.map(a => a.id === assignmentId ? res.assignment : a)
          };
        });

        addToast({
          variant: 'success',
          title: 'Checkpoint Updated',
          message: `${res.assignment.junction_name} marked as ${newStatus.replace(/_/g, ' ')}`
        });
      }
    } catch (err: any) {
      addToast({
        variant: 'error',
        title: 'Action Failed',
        message: err.message || 'Could not update checkpoint status'
      });
    } finally {
      setIsTransitioningStatus(null);
    }
  };

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

                    {/* Route Checkpoint Junction Markers */}
                    {(routeAssignmentsByIncident[incident.id] || []).map(asg => {
                      let jStatus: 'NORMAL' | 'PREPARING' | 'CLEARED' | 'PASSED' = 'NORMAL';
                      if (['CLEARANCE_CONFIRMED'].includes(asg.status)) jStatus = 'CLEARED';
                      else if (['EN_ROUTE_TO_POSITION', 'READY'].includes(asg.status)) jStatus = 'PREPARING';
                      else if (['PASSED', 'COMPLETED'].includes(asg.status)) jStatus = 'PASSED';

                      return (
                        <JunctionMarker
                          key={asg.id}
                          position={[asg.junction_latitude, asg.junction_longitude]}
                          name={`P${asg.sequence_order}: ${asg.junction_name}`}
                          status={jStatus}
                          distanceMeters={asg.distance_from_ambulance_meters}
                          policeName={asg.police_name}
                        />
                      );
                    })}
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

                        {/* Route Checkpoints & Sequential Coordination */}
                        {(() => {
                          const checkpoints = routeAssignmentsByIncident[incident.id] || [];
                          const gapCount = checkpoints.filter(c => !c.police_id || c.is_coverage_gap).length;

                          return (
                            <div className="space-y-2 mt-3 pt-3 border-t border-slate-800" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <Navigation className="w-3.5 h-3.5 text-cyan-400" />
                                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-300">
                                    Route Checkpoints ({checkpoints.length})
                                  </span>
                                </div>
                                {gapCount > 0 ? (
                                  <span className="text-[9px] font-black text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                                    {gapCount} COVERAGE GAP{gapCount > 1 ? 'S' : ''}
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                                    FULLY COVERED
                                  </span>
                                )}
                              </div>

                              {checkpoints.length === 0 ? (
                                <p className="text-[11px] text-slate-500 italic py-1">
                                  Calculating road-following checkpoints ahead of ambulance...
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  {checkpoints.map((asg) => {
                                    const isMyAssignment = asg.police_id === policeProfile?.id;
                                    const isTransitioning = isTransitioningStatus === asg.id;
                                    const distKm = (asg.distance_from_ambulance_meters / 1000).toFixed(1);
                                    const etaMin = asg.ambulance_eta_seconds != null ? Math.max(1, Math.round(asg.ambulance_eta_seconds / 60)) : Math.max(1, Math.round(asg.distance_from_ambulance_meters / 500));

                                    const statusBadgeStyle = 
                                      asg.status === 'CLEARANCE_CONFIRMED' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
                                      asg.status === 'READY' ? 'bg-teal-500/20 text-teal-300 border-teal-500/40' :
                                      asg.status === 'EN_ROUTE_TO_POSITION' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' :
                                      asg.status === 'ACKNOWLEDGED' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' :
                                      asg.status === 'PASSED' || asg.status === 'COMPLETED' ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' :
                                      asg.status === 'BLOCKED' || asg.status === 'CLEARANCE_REVOKED' ? 'bg-red-500/20 text-red-400 border-red-500/40' :
                                      asg.status === 'REJECTED' || asg.status === 'UNAVAILABLE' ? 'bg-rose-500/20 text-rose-400 border-rose-500/40' :
                                      'bg-amber-500/20 text-amber-300 border-amber-500/40';

                                    return (
                                      <div
                                        key={asg.id}
                                        className={`rounded-lg p-2.5 border transition-all text-xs ${
                                          isMyAssignment
                                            ? 'bg-cyan-950/20 border-cyan-500/40 shadow-sm'
                                            : 'bg-[#0A0E17] border-slate-800/80'
                                        }`}
                                      >
                                        <div className="flex justify-between items-start gap-2 mb-1.5">
                                          <div>
                                            <div className="flex items-center gap-1.5">
                                              <span className="font-mono font-black text-cyan-400 bg-cyan-950/70 px-1.5 py-0.5 rounded text-[10px]">
                                                P{asg.sequence_order}
                                              </span>
                                              <span className="font-bold text-white text-[11px] leading-tight">
                                                {asg.junction_name}
                                              </span>
                                            </div>
                                            <p className="text-[10px] text-slate-400 mt-0.5">
                                              {distKm} km ahead • Amb ETA ~{etaMin}m
                                            </p>
                                          </div>

                                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border shrink-0 ${statusBadgeStyle}`}>
                                            {asg.status.replace(/_/g, ' ')}
                                          </span>
                                        </div>

                                        {/* Assigned Officer Tag */}
                                        <div className="flex items-center justify-between text-[10px] text-slate-400 py-1 border-t border-slate-800/60 mb-1.5">
                                          <span>Assigned:</span>
                                          {isMyAssignment ? (
                                            <span className="font-bold text-cyan-400 flex items-center gap-1">
                                              <Shield className="w-3 h-3" /> YOU (Primary Unit)
                                            </span>
                                          ) : asg.police_name ? (
                                            <span className="font-medium text-slate-300">{asg.police_name}</span>
                                          ) : (
                                            <span className="font-bold text-amber-400 bg-amber-950/60 px-1.5 py-0.2 rounded border border-amber-800">
                                              ⚠️ UNASSIGNED GAP
                                            </span>
                                          )}
                                        </div>

                                        {/* State Machine Transition Actions */}
                                        {(isMyAssignment || (!asg.police_id && asg.status === 'PROPOSED')) && (
                                          <div className="pt-1.5 border-t border-slate-800/60 flex flex-wrap gap-1.5">
                                            {['PROPOSED', 'NOTIFIED'].includes(asg.status) && (
                                              <>
                                                <button
                                                  disabled={isTransitioning}
                                                  onClick={() => handleCheckpointStatusTransition(asg.id, 'ACKNOWLEDGED')}
                                                  className="flex-1 py-1 px-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[10px] transition-colors cursor-pointer disabled:opacity-50"
                                                >
                                                  {isTransitioning ? 'Updating...' : 'Acknowledge Sector'}
                                                </button>
                                                <button
                                                  disabled={isTransitioning}
                                                  onClick={() => {
                                                    setSelectedAssignmentForDecline(asg);
                                                    setDeclineModalOpen(true);
                                                  }}
                                                  className="py-1 px-2 rounded bg-slate-800 hover:bg-red-950 text-red-400 font-bold text-[10px] border border-red-900/50 transition-colors cursor-pointer"
                                                >
                                                  Decline
                                                </button>
                                              </>
                                            )}

                                            {asg.status === 'ACKNOWLEDGED' && (
                                              <button
                                                disabled={isTransitioning}
                                                onClick={() => handleCheckpointStatusTransition(asg.id, 'EN_ROUTE_TO_POSITION')}
                                                className="w-full py-1 px-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold text-[10px] transition-colors cursor-pointer"
                                              >
                                                {isTransitioning ? 'Updating...' : '→ En Route to Sector Post'}
                                              </button>
                                            )}

                                            {asg.status === 'EN_ROUTE_TO_POSITION' && (
                                              <button
                                                disabled={isTransitioning}
                                                onClick={() => handleCheckpointStatusTransition(asg.id, 'READY')}
                                                className="w-full py-1 px-2 rounded bg-teal-600 hover:bg-teal-500 text-white font-bold text-[10px] transition-colors cursor-pointer"
                                              >
                                                {isTransitioning ? 'Updating...' : '✓ Sector Ready (At Post)'}
                                              </button>
                                            )}

                                            {asg.status === 'READY' && (
                                              <>
                                                <button
                                                  disabled={isTransitioning}
                                                  onClick={() => handleCheckpointStatusTransition(asg.id, 'CLEARANCE_CONFIRMED')}
                                                  className="flex-1 py-1 px-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] transition-colors cursor-pointer shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                                                >
                                                  {isTransitioning ? 'Updating...' : '⚡ Confirm Clearance'}
                                                </button>
                                                <button
                                                  disabled={isTransitioning}
                                                  onClick={() => {
                                                    setSelectedAssignmentForBlockage(asg);
                                                    setBlockageModalOpen(true);
                                                  }}
                                                  className="py-1 px-2 rounded bg-slate-800 hover:bg-red-950 text-red-400 font-bold text-[10px] border border-red-900/50 transition-colors cursor-pointer"
                                                >
                                                  Blockage
                                                </button>
                                              </>
                                            )}

                                            {asg.status === 'CLEARANCE_CONFIRMED' && (
                                              <>
                                                <button
                                                  disabled={isTransitioning}
                                                  onClick={() => handleCheckpointStatusTransition(asg.id, 'PASSED')}
                                                  className="flex-1 py-1 px-2 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold text-[10px] transition-colors cursor-pointer"
                                                >
                                                  {isTransitioning ? 'Updating...' : 'Ambulance Passed'}
                                                </button>
                                                <button
                                                  disabled={isTransitioning}
                                                  onClick={() => handleCheckpointStatusTransition(asg.id, 'CLEARANCE_REVOKED', { reason: 'Traffic surge or obstacle reopened' })}
                                                  className="py-1 px-2 rounded bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 font-bold text-[10px] border border-amber-800 transition-colors cursor-pointer"
                                                >
                                                  Revoke
                                                </button>
                                              </>
                                            )}

                                            {asg.status === 'PASSED' && (
                                              <button
                                                disabled={isTransitioning}
                                                onClick={() => handleCheckpointStatusTransition(asg.id, 'COMPLETED')}
                                                className="w-full py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[10px] transition-colors cursor-pointer"
                                              >
                                                {isTransitioning ? 'Updating...' : 'Mark Completed'}
                                              </button>
                                            )}

                                            {['BLOCKED', 'CLEARANCE_REVOKED'].includes(asg.status) && (
                                              <button
                                                disabled={isTransitioning}
                                                onClick={() => handleCheckpointStatusTransition(asg.id, 'READY', { notes: 'Blockage cleared' })}
                                                className="w-full py-1 px-2 rounded bg-teal-700 hover:bg-teal-600 text-white font-bold text-[10px] transition-colors cursor-pointer"
                                              >
                                                {isTransitioning ? 'Updating...' : 'Clear Obstruction & Re-Ready'}
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* General Corridor Action Buttons */}
                        <div className="space-y-2 mt-3 pt-3 border-t border-slate-800/80" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                              Corridor Green-Wave Status
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
                              title="Confirm entire corridor is clear for priority transport"
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

        {/* Modal: Report Junction Blockage */}
        <Dialog
          open={blockageModalOpen}
          onClose={() => setBlockageModalOpen(false)}
          title="Report Junction Obstruction / Blockage"
          variant="danger"
          confirmLabel="Submit Blockage Alert"
          onConfirm={() => {
            if (selectedAssignmentForBlockage) {
              handleCheckpointStatusTransition(selectedAssignmentForBlockage.id, 'BLOCKED', {
                blockageDetails: blockageNotes || 'Unspecified blockage reported by officer'
              });
              setBlockageModalOpen(false);
              setBlockageNotes('');
            }
          }}
        >
          <div className="space-y-3 text-xs text-slate-300">
            <p>
              Report a road blockage or severe obstruction at{' '}
              <strong className="text-white">{selectedAssignmentForBlockage?.junction_name}</strong>.
              This will update the central coordination plan and alert dispatch for rerouting or reinforcement.
            </p>
            <textarea
              rows={3}
              placeholder="Describe obstruction (e.g. stalled truck, waterlogging, active collision)..."
              value={blockageNotes}
              onChange={(e) => setBlockageNotes(e.target.value)}
              className="w-full bg-[#131826] border border-slate-700 rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
            />
          </div>
        </Dialog>

        {/* Modal: Decline / Report Unavailable */}
        <Dialog
          open={declineModalOpen}
          onClose={() => setDeclineModalOpen(false)}
          title="Decline Assignment / Report Unavailable"
          variant="danger"
          confirmLabel="Confirm Decline"
          onConfirm={() => {
            if (selectedAssignmentForDecline) {
              handleCheckpointStatusTransition(selectedAssignmentForDecline.id, 'REJECTED', {
                rejectionReason: declineReason
              });
              setDeclineModalOpen(false);
            }
          }}
        >
          <div className="space-y-3 text-xs text-slate-300">
            <p>
              Please state why you cannot cover{' '}
              <strong className="text-white">{selectedAssignmentForDecline?.junction_name}</strong>.
              The coordination engine will immediately attempt to dispatch an eligible nearby reinforcement unit.
            </p>
            <select
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              className="w-full bg-[#131826] border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="UNAVAILABLE_OTHER_EMERGENCY">Engaged in higher-priority local emergency</option>
              <option value="OUTSIDE_PATROL_SECTOR">Beyond current patrol jurisdiction</option>
              <option value="EQUIPMENT_VEHICLE_FAILURE">Vehicle or radio equipment failure</option>
              <option value="TRAFFIC_GRIDLOCK_EN_ROUTE">Severe local gridlock preventing transit to post</option>
            </select>
          </div>
        </Dialog>

      </div>
    </AppShell>
  );
}
