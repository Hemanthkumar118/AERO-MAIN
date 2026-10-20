import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../../../components/layout/AppShell';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../providers/AuthProvider';
import { realtimeService } from '../../../services/realtimeService';
import type { EmergencyIncident, SOSState, Hospital } from '../../../types';
import { ArrowLeft, Clock, Activity, Target, Shield, CheckCircle2, AlertTriangle, ChevronRight } from 'lucide-react';

export function SOSInformationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  // const [error, setError] = useState<string | null>(null);
  
  const [sosState, setSosState] = useState<SOSState | null>(null);
  const [incident, setIncident] = useState<EmergencyIncident | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!user) return;

    const fetchActiveIncident = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('emergency_incidents')
          .select('*')
          .eq('user_id', user.id)
          .in('status', ['active', 'dispatched', 'en_route'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        
        if (mounted) {
          if (data) {
            setIncident(data as EmergencyIncident);
            mapToSosState(data as EmergencyIncident);
          } else {
            setIncident(null);
            setSosState(null);
          }
        }
      } catch (err: any) {
        console.error("Failed to load active emergency:", err);
        // if (mounted) setError(err.message || 'Failed to load emergency data');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchActiveIncident();

    // Listen for realtime updates
    const unsub = realtimeService.on('incidents_updated', (incidents: EmergencyIncident[]) => {
      if (!mounted) return;
      const myActive = incidents.find(inc => inc.user_id === user.id && ['active', 'dispatched', 'en_route'].includes(inc.status));
      if (myActive) {
        setIncident(myActive);
        mapToSosState(myActive);
      } else {
        // If it was completed or aborted
        const myLatest = incidents.find(inc => inc.user_id === user.id);
        if (myLatest) {
           setIncident(myLatest);
           mapToSosState(myLatest);
        }
      }
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, [user]);

  const mapToSosState = (inc: EmergencyIncident) => {
    const state: SOSState = {
      status: inc.status === 'cancelled' ? 'ABORTED' : (inc.status === 'resolved' || inc.status === 'arrived' ? 'COMPLETED' : 'ACTIVE'),
      emergencyId: inc.id,
      routeStatus: inc.route_geometry ? 'SUCCESS' : 'PENDING',
      policeStatus: inc.police_acknowledged_at ? 'DELIVERED' : (inc.corridor_status !== 'PENDING' ? 'SENT' : 'PENDING'),
      hospitalStatus: 'PENDING', // We don't have hospital tracking yet
      ambulanceLocation: { latitude: inc.current_latitude || 0, longitude: inc.current_longitude || 0 },
      destination: {
        id: 'dest',
        name: inc.destination_hospital || 'Hospital',
        address: inc.destination_hospital || '',
        location: { latitude: inc.destination_latitude, longitude: inc.destination_longitude },
        emergencyCapable: true,
      } as Hospital,
      distanceMeters: inc.route_distance_meters,
      etaSeconds: inc.route_duration_seconds,
      trafficAwareEtaSeconds: inc.traffic_duration_seconds,
      trafficStatus: inc.traffic_status as any,
      startedAt: inc.created_at,
      updatedAt: inc.updated_at,
    };
    setSosState(state);
  };

  const handleAbort = async () => {
    if (!incident || !window.confirm("Are you sure you want to abort this emergency?")) return;
    
    try {
      const { error } = await supabase
        .from('emergency_incidents')
        .update({ status: 'cancelled' })
        .eq('id', incident.id);
        
      if (error) throw error;
      navigate('/ambulance');
    } catch (err: any) {
      alert(`Failed to abort: ${err.message}`);
    }
  };

  const handleComplete = async () => {
    if (!incident || !window.confirm("Mark this emergency as completed/arrived?")) return;
    
    try {
      const { error } = await supabase
        .from('emergency_incidents')
        .update({ status: 'arrived', resolved_at: new Date().toISOString() })
        .eq('id', incident.id);
        
      if (error) throw error;
      navigate('/ambulance');
    } catch (err: any) {
      alert(`Failed to complete: ${err.message}`);
    }
  };

  const connState = realtimeService.getConnectionState();

  if (loading) {
    return (
      <AppShell userRole="AMBULANCE" userName="Ambulance" connectionState={connState} gpsState="active">
        <div className="flex h-full items-center justify-center bg-aero-background text-aero-text-primary">
           Loading SOS Information...
        </div>
      </AppShell>
    );
  }

  if (!incident || !sosState || sosState.status === 'ABORTED' || sosState.status === 'COMPLETED') {
    return (
      <AppShell userRole="AMBULANCE" userName="Ambulance" connectionState={connState} gpsState="active">
        <div className="flex flex-col h-full items-center justify-center bg-aero-background p-6 text-center">
          <AlertTriangle className="w-16 h-16 text-yellow-500 mb-4" />
          <h2 className="text-2xl font-bold text-aero-text-primary mb-2">NO ACTIVE SOS</h2>
          <p className="text-aero-text-secondary mb-6 max-w-md">No active emergency is currently associated with this ambulance. If you just completed or aborted an emergency, it has been logged securely.</p>
          <button 
            onClick={() => navigate('/ambulance')}
            className="bg-aero-surface hover:bg-aero-surface-soft text-aero-text-primary px-6 py-3 rounded-lg border border-aero-border transition-colors font-bold"
          >
            BACK TO AMBULANCE DASHBOARD
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell userRole="AMBULANCE" userName="Ambulance" connectionState={connState} gpsState="active">
      <div className="flex flex-col h-full bg-aero-background overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-aero-background/80 backdrop-blur-md border-b border-aero-border p-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
             <button 
               onClick={() => navigate('/ambulance')}
               className="flex items-center gap-2 text-aero-text-secondary hover:text-aero-text-primary transition-colors"
             >
               <ArrowLeft className="w-5 h-5" />
               <span className="font-medium text-sm">Map View</span>
             </button>
             <h1 className="text-lg font-bold text-aero-text-primary tracking-widest">SOS INFORMATION</h1>
             <div className="flex items-center gap-2 text-xs font-bold text-aero-red bg-aero-red-soft px-3 py-1.5 rounded-full border border-[#FF3B30]/20 animate-pulse">
               <span className="w-2 h-2 rounded-full bg-aero-red" />
               ACTIVE
             </div>
          </div>
        </div>

        <div className="p-4 md:p-8 max-w-4xl mx-auto w-full space-y-6">
          {/* Section: EMERGENCY */}
          <section className="bg-aero-surface border border-aero-border rounded-xl overflow-hidden">
            <div className="bg-aero-surface-soft border-b border-aero-border px-4 py-3 flex items-center gap-2">
               <Activity className="w-4 h-4 text-aero-blue" />
               <h2 className="text-sm font-bold text-aero-text-primary uppercase tracking-wider">Emergency</h2>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
               <div>
                 <div className="text-xs text-aero-text-secondary uppercase">Emergency ID</div>
                 <div className="font-mono text-sm text-aero-text-primary mt-1">{incident.id}</div>
               </div>
               <div>
                 <div className="text-xs text-aero-text-secondary uppercase">Started</div>
                 <div className="text-sm text-aero-text-primary mt-1">
                    {new Intl.DateTimeFormat('en-GB', { 
                        day: '2-digit', month: 'short', year: 'numeric', 
                        hour: '2-digit', minute: '2-digit', hour12: true 
                    }).format(new Date(incident.created_at))}
                 </div>
               </div>
               <div>
                 <div className="text-xs text-aero-text-secondary uppercase">Category</div>
                 <div className="text-sm font-bold text-aero-text-primary mt-1">{incident.incident_type}</div>
               </div>
               <div>
                 <div className="text-xs text-aero-text-secondary uppercase">Priority</div>
                 <div className="text-sm font-bold text-aero-red mt-1">{incident.priority?.toUpperCase()}</div>
               </div>
            </div>
          </section>

          {/* Section: DESTINATION & NAVIGATION */}
          <section className="bg-aero-surface border border-aero-border rounded-xl overflow-hidden">
            <div className="bg-aero-surface-soft border-b border-aero-border px-4 py-3 flex items-center gap-2">
               <Target className="w-4 h-4 text-aero-green" />
               <h2 className="text-sm font-bold text-aero-text-primary uppercase tracking-wider">Destination & Navigation</h2>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="md:col-span-2">
                 <div className="text-xs text-aero-text-secondary uppercase">Hospital</div>
                 <div className="text-base font-bold text-aero-text-primary mt-1">{incident.destination_hospital}</div>
                 {/* {incident.destination_address && <div className="text-xs text-aero-text-secondary mt-1">{incident.destination_address}</div>} */}
               </div>
               <div>
                 <div className="text-xs text-aero-text-secondary uppercase">Distance Remaining</div>
                 <div className="text-xl font-bold text-aero-text-primary mt-1">
                   {incident.route_distance_meters ? (incident.route_distance_meters / 1000).toFixed(1) + ' km' : 'Calculating...'}
                 </div>
               </div>
               <div>
                 <div className="text-xs text-aero-text-secondary uppercase flex items-center gap-2">
                   ETA
                   {incident.traffic_status === 'LIVE' && (
                     <span className="text-[9px] bg-aero-surface-soft text-aero-text-secondary px-1 py-0.5 rounded border border-aero-border font-bold uppercase">ROUTE ETA</span>
                   )}
                 </div>
                 <div className="text-xl font-bold text-aero-text-primary mt-1">
                   {(incident.traffic_duration_seconds || incident.route_duration_seconds) ? Math.round((incident.traffic_duration_seconds || incident.route_duration_seconds!) / 60) + ' min' : 'Calculating...'}
                 </div>
               </div>
               <div className="md:col-span-2">
                 <div className="text-xs text-aero-text-secondary uppercase">Navigation Status</div>
                 <div className="text-sm font-bold text-aero-blue mt-1 flex items-center gap-2">
                    <ChevronRight className="w-4 h-4" />
                    {sosState.routeStatus === 'SUCCESS' ? 'ON ROUTE' : (sosState.routeStatus === 'ERROR' ? 'ROUTE ERROR' : 'REROUTING / PENDING')}
                 </div>
               </div>
            </div>
          </section>

          {/* Section: AMBULANCE TELEMETRY */}
          <section className="bg-aero-surface border border-aero-border rounded-xl overflow-hidden">
            <div className="bg-aero-surface-soft border-b border-aero-border px-4 py-3 flex items-center gap-2">
               <Activity className="w-4 h-4 text-purple-400" />
               <h2 className="text-sm font-bold text-aero-text-primary uppercase tracking-wider">Ambulance Telemetry</h2>
            </div>
            <div className="p-4 grid grid-cols-2 gap-4">
               <div className="col-span-2 md:col-span-1">
                 <div className="text-xs text-aero-text-secondary uppercase">Current Location</div>
                 <div className="font-mono text-sm text-aero-blue mt-1">
                    {incident.current_latitude?.toFixed(5) || '--'}, {incident.current_longitude?.toFixed(5) || '--'}
                 </div>
               </div>
               <div>
                 <div className="text-xs text-aero-text-secondary uppercase">GPS Accuracy</div>
                 <div className="text-sm text-aero-text-primary mt-1">
                    {incident.current_accuracy ? `${Math.round(incident.current_accuracy)} m` : 'Active'}
                 </div>
               </div>
               <div>
                 <div className="text-xs text-aero-text-secondary uppercase">Speed</div>
                 <div className="text-sm font-bold text-aero-text-primary mt-1">
                    {incident.current_speed ? `${Math.round(incident.current_speed)} km/h` : '0 km/h'}
                 </div>
               </div>
               <div>
                 <div className="text-xs text-aero-text-secondary uppercase">Heading</div>
                 <div className="text-sm text-aero-text-primary mt-1">
                    {incident.current_heading !== undefined && incident.current_heading !== null ? `${Math.round(incident.current_heading)}°` : '--'}
                 </div>
               </div>
            </div>
          </section>

          {/* Section: COORDINATION */}
          <section className="bg-aero-surface border border-aero-border rounded-xl overflow-hidden">
            <div className="bg-aero-surface-soft border-b border-aero-border px-4 py-3 flex items-center gap-2">
               <Shield className="w-4 h-4 text-orange-400" />
               <h2 className="text-sm font-bold text-aero-text-primary uppercase tracking-wider">Coordination</h2>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
               <div>
                 <div className="text-xs text-aero-text-secondary uppercase">Police Status</div>
                 <div className={`text-sm font-bold mt-1 flex items-center gap-2 ${
                    sosState.policeStatus === 'DELIVERED' ? 'text-aero-green' : 
                    sosState.policeStatus === 'SENT' ? 'text-aero-amber' : 'text-aero-text-secondary'
                 }`}>
                   {sosState.policeStatus === 'DELIVERED' ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                   {sosState.policeStatus === 'DELIVERED' ? 'ACKNOWLEDGED' : (sosState.policeStatus === 'SENT' ? 'NOTIFIED' : 'PENDING')}
                 </div>
               </div>
               <div>
                 <div className="text-xs text-aero-text-secondary uppercase">Hospital Status</div>
                 <div className={`text-sm font-bold mt-1 flex items-center gap-2 ${
                    sosState.hospitalStatus === 'DELIVERED' ? 'text-aero-green' : 
                    sosState.hospitalStatus === 'SENT' ? 'text-aero-amber' : 'text-aero-text-secondary'
                 }`}>
                   {sosState.hospitalStatus === 'DELIVERED' ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                   {sosState.hospitalStatus === 'DELIVERED' ? 'ACKNOWLEDGED' : (sosState.hospitalStatus === 'SENT' ? 'NOTIFIED' : 'PENDING')}
                 </div>
               </div>
            </div>
          </section>
          
          <div className="pt-4 border-t border-aero-border flex items-center justify-between">
             <button
               onClick={handleAbort}
               className="px-6 py-3 rounded-lg bg-aero-surface hover:bg-aero-red-soft text-aero-red border border-aero-red/20 transition-colors font-bold text-sm"
             >
               ABORT EMERGENCY
             </button>
             <button
               onClick={handleComplete}
               className="px-6 py-3 rounded-lg bg-aero-green-soft hover:bg-aero-green-soft text-aero-green border border-aero-green/30 transition-colors font-bold text-sm"
             >
               MARK ARRIVED
             </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
