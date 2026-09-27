import { useState, useEffect, useRef } from 'react';
import { AppShell } from '../../../components/layout/AppShell';
import {
  MapView,
  HospitalMarker,
  RoutePolyline,
} from '../../../components/map';
import { AmbulanceGPSMarker } from '../components/AmbulanceGPSMarker';
import { SOSController } from '../components/SOSController';
import { HospitalSearchPanel } from '../components/HospitalSearchPanel';
import { HospitalPins } from '../components/HospitalPins';
import { SOSInformationPanel } from '../components/SOSInformationPanel';
import { realtimeService } from '../../../services/realtimeService';
import { routingService } from '../../../services/routingService';
import { TrafficAwareRoutingProvider } from '../../../services/TrafficAwareRoutingProvider';
import { geolocationService } from '../../../services/geolocationService';
import { discoverHospitals } from '../../../services/hospitalSearch';
import type { NormalizedHospital } from '../../../services/hospitalSearch/types';
import type {
  EmergencyIncident,
  EmergencyCategory,
  EmergencyPriority,
  Hospital,
} from '../../../types';
import { supabase } from '../../../lib/supabase';
import { motion } from 'framer-motion';
import { useAuth } from '../../../providers/AuthProvider';

export function AmbulanceDashboard() {
  const { user, profile } = useAuth();
  const [ambulance] = useState({
    id: user?.id || 'unknown-id',
    name: profile?.full_name || 'Ambulance Operator',
    vehicleNumber: 'AERO ALS-01', // Removed profile?.organization as it doesn't exist
    heading: 0,
    speedKmH: 0,
  });

  // Base Map State (initialized once or on major shifts, avoids micro-rerenders)
  const [baseLocation, setBaseLocation] = useState<[number, number] | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [gpsTimestamp, setGpsTimestamp] = useState<Date | null>(null);

  // Hospital & Routing state
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [loadingHospitals, setLoadingHospitals] = useState(false);
  const [hospitalError, setHospitalError] = useState<string | null>(null);
  const [hospitalResults, setHospitalResults] = useState<NormalizedHospital[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const [selectedHospital, setSelectedHospital] = useState<Hospital | null>(null);
  const [routeInfo, setRouteInfo] = useState<any | null>(null);
  
  // Navigation State
  const [navigationStatus, setNavigationStatus] = useState<'idle' | 'active' | 'rerouting' | 'arrived' | 'error'>('idle');
  const currentLiveLocation = useRef<[number, number] | null>(null);
  const lastRouteCalculationTime = useRef<number>(0);
  const isRouting = useRef(false);

  // UI state
  const [followLiveLocation, setFollowLiveLocation] = useState(true);

  // Emergency State
  const [category] = useState<EmergencyCategory>('CARDIAC');
  const [priority] = useState<EmergencyPriority>('CODE_RED');
  const [activeIncident, setActiveIncident] = useState<EmergencyIncident | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const [currentAccuracy, setCurrentAccuracy] = useState<number | undefined>(undefined);

  // 1. Initialize Realtime Services
  useEffect(() => {
    // Check initial active incident
    const fetchInitial = async () => {
      const { data } = await supabase
        .from('emergency_incidents')
        .select('*')
        .eq('user_id', user?.id || ambulance.id)
        .in('status', ['active', 'dispatched', 'en_route'])
        .maybeSingle();
      if (data) setActiveIncident(data as EmergencyIncident);
    };
    fetchInitial();

    const unsub = realtimeService.on('incidents_updated', (incidents: EmergencyIncident[]) => {
      const myActive = incidents.find(inc => ['active', 'dispatched', 'en_route'].includes(inc.status) && inc.user_id === (user?.id || ambulance.id));
      setActiveIncident(myActive || null);
      if (!myActive) {
        setNavigationStatus('idle');
        setRouteInfo(null);
      }
    });
    return () => unsub();
  }, [ambulance.id]);

  const handleAbort = async () => {
    if (!activeIncident || !window.confirm("Are you sure you want to abort this emergency?")) return;
    try {
      const { error } = await supabase
        .from('emergency_incidents')
        .update({ status: 'cancelled' })
        .eq('id', activeIncident.id);
      if (error) throw error;
      setActiveIncident(null);
      setNavigationStatus('idle');
      setRouteInfo(null);
    } catch (err: any) {
      alert(`Failed to abort: ${err.message}`);
    }
  };

  const handleComplete = async () => {
    if (!activeIncident || !window.confirm("Mark this emergency as completed/arrived?")) return;
    try {
      const { error } = await supabase
        .from('emergency_incidents')
        .update({ status: 'arrived', resolved_at: new Date().toISOString() })
        .eq('id', activeIncident.id);
      if (error) throw error;
      setActiveIncident(null);
      setNavigationStatus('idle');
      setRouteInfo(null);
    } catch (err: any) {
      alert(`Failed to complete: ${err.message}`);
    }
  };

  // 2. Initialize Geolocation for Base Point
  useEffect(() => {
    geolocationService.getCurrentPosition()
      .then(pos => {
        setBaseLocation([pos.latitude, pos.longitude]);
        setCurrentAccuracy(pos.accuracy);
        setGpsEnabled(true);
        setGpsError(null);
        setGpsTimestamp(new Date());
      })
      .catch(err => {
        setGpsError(err.message || 'GPS denied or unavailable');
        setGpsEnabled(false);
      });
      
    // Start tracking in the background. AmbulanceGPSMarker will listen directly.
    geolocationService.startWatching();
    return () => geolocationService.stopWatching();
  }, []);

  // We no longer sync to Supabase in a setInterval. We will do it in `handleLocationUpdate`
  // when the GPS actually changes significantly, reducing database load and matching GPS reality.

  // 3. Auto-discover Hospitals
  useEffect(() => {
    if (!baseLocation || activeIncident) return;

    const fetchAndRankHospitals = async () => {
      setLoadingHospitals(true);
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        setHospitalError(null);
        let results = await discoverHospitals(baseLocation[0], baseLocation[1], radiusKm * 1000, debouncedSearchQuery, abortRef.current.signal);
        
        if (results.length > 0) {
          const ranked = await routingService.rankHospitalsByTravelTime(baseLocation, results);
          setHospitalResults(ranked);

          // Auto-select the nearest one if nothing selected yet
          if (!selectedHospital) {
            const best = ranked[0];
            setSelectedHospital({
              id: best.id,
              name: best.name,
              address: best.address || best.name,
              location: { latitude: best.lat, longitude: best.lng },
              phone: best.phone || '',
              emergencyCapable: true,
              totalBeds: 0, availableIcuBeds: 0, traumaBaysAvailable: 0, doctorsOnDuty: 0,
              distanceKm: parseFloat(((best as any).drivingDistanceMeters / 1000).toFixed(1)),
              drivingEtaSeconds: (best as any).drivingEtaSeconds
            } as any);

            // Just set selected hospital, do not calculate/set route yet (SOS triggers it)
          }
        } else {
          setHospitalResults([]);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn(err);
          setHospitalError(err.message || 'HOSPITAL SEARCH ERROR');
        }
      } finally {
        setLoadingHospitals(false);
      }
    };

    fetchAndRankHospitals();
  }, [baseLocation, radiusKm, activeIncident, debouncedSearchQuery]);

  const filteredHospitals = hospitalResults;

  const handleSearchSelect = async (h: NormalizedHospital) => {
    const hosp: any = {
      id: h.id,
      name: h.name,
      address: h.address || h.name,
      location: { latitude: h.lat, longitude: h.lng },
      phone: h.phone || '',
      emergencyCapable: true,
      distanceKm: parseFloat((h.distanceMeters / 1000).toFixed(1)),
    };
    
    setSelectedHospital(hosp);
    
    // Immediately calculate and show the preview route
    if (baseLocation) {
      try {
        const route = await TrafficAwareRoutingProvider.getFastestRoute(baseLocation, [h.lat, h.lng]);
        if (route && route.polyline.length > 0) {
          setRouteInfo(route);
          setNavigationStatus('idle'); // not active emergency yet
          lastRouteCalculationTime.current = Date.now();
        } else {
          setRouteInfo(null);
          setNavigationStatus('error');
        }
      } catch (err) {
        setRouteInfo(null);
        setNavigationStatus('error');
      }
    } else {
      setRouteInfo(null);
      setNavigationStatus('idle');
    }
  };

  // Live Location Update & Off-Route Detection
  const lastSupabaseSyncTime = useRef<number>(0);

  const handleLocationUpdate = async (gpsData: any) => {
    const pos: [number, number] = [gpsData.latitude, gpsData.longitude];
    currentLiveLocation.current = pos;
    setGpsTimestamp(new Date());
    setCurrentAccuracy(gpsData.accuracy);
    
    // Sync to Supabase if we have an active emergency (throttle to every 3 seconds to avoid spam)
    if (activeIncident) {
      const now = Date.now();
      if (now - lastSupabaseSyncTime.current > 3000) {
        lastSupabaseSyncTime.current = now;
        supabase.from('emergency_incidents').update({
          current_latitude: gpsData.latitude,
          current_longitude: gpsData.longitude,
          current_speed: gpsData.speed != null ? (gpsData.speed * 3.6) : null,
          current_heading: gpsData.heading || 0,
        }).eq('id', activeIncident.id).then(({ error }: any) => {
          if (error) console.error("Failed to sync GPS to Supabase:", error);
        });
      }
    }
    
    // If navigation is active and we have a route
    if ((activeIncident || selectedHospital) && routeInfo?.polyline && routeInfo.polyline.length > 0) {
      // 1. Check if arrived
      const dest = selectedHospital 
        ? [selectedHospital.location.latitude, selectedHospital.location.longitude] as [number, number]
        : null;
        
      if (dest) {
        const distToDest = routingService.getDistanceToRoute(pos, [dest, dest]); // haversine to point
        if (distToDest < 50 && navigationStatus !== 'arrived') {
          setNavigationStatus('arrived');
          return;
        }
      }

      // 2. Off-route detection (threshold 100 meters)
      const distToRoute = routingService.getDistanceToRoute(pos, routeInfo.polyline);
      const isOffRoute = distToRoute > parseInt(import.meta.env.VITE_REROUTE_DISTANCE_METERS || '100');
      
      const shouldReroute = TrafficAwareRoutingProvider.shouldReroute(
        routeInfo, lastRouteCalculationTime.current, isOffRoute
      );
      
      if (shouldReroute && !isRouting.current && navigationStatus !== 'arrived') {
        const now = Date.now();
        // Debounce rerouting by configured minimum interval
        const minInterval = parseInt(import.meta.env.VITE_REROUTE_MIN_INTERVAL_SECONDS || '10') * 1000;
        
        if (now - lastRouteCalculationTime.current > minInterval) {
          isRouting.current = true;
          setNavigationStatus('rerouting');
          
          try {
             if (dest) {
               const newRoute = await TrafficAwareRoutingProvider.getFastestRoute(pos, dest);
               if (newRoute && newRoute.polyline.length > 0) {
                 const currentEta = routeInfo?.trafficAwareEtaSeconds || routeInfo?.etaSeconds || Infinity;
                 const newEta = newRoute.trafficAwareEtaSeconds || newRoute.etaSeconds;
                 const etaImprovementThreshold = parseInt(import.meta.env.VITE_ETA_IMPROVEMENT_THRESHOLD_SECONDS || '120');
                 const isSignificantlyBetter = (currentEta - newEta) > etaImprovementThreshold;

                 if (isOffRoute || isSignificantlyBetter) {
                   setRouteInfo(newRoute);
                   setNavigationStatus('active');
                   lastRouteCalculationTime.current = Date.now();
                   
                   // If it's an active incident, also update the route on Supabase
                   if (activeIncident) {
                     const newVersion = (activeIncident.route_version || 1) + 1;
                     supabase.from('emergency_incidents').update({
                       route_geometry: newRoute.polyline,
                       route_distance_meters: newRoute.distanceMeters,
                       route_duration_seconds: newRoute.etaSeconds,
                       traffic_duration_seconds: newRoute.trafficAwareEtaSeconds || newRoute.etaSeconds,
                       traffic_status: newRoute.trafficStatus || 'UNAVAILABLE',
                       route_provider: newRoute.routeProvider || 'osrm',
                       route_version: newVersion,
                       last_reroute_at: new Date().toISOString(),
                       route_updated_at: new Date().toISOString()
                     }).eq('id', activeIncident.id).then();
                   }
                 } else {
                   // Keep existing route if not significantly better and not off-route
                   setNavigationStatus('active');
                 }
               } else {
                 setNavigationStatus('error');
               }
             }
          } catch {
             setNavigationStatus('error');
          } finally {
             isRouting.current = false;
          }
        }
      }
    }
  };

  const destinationPos: [number, number] | null = selectedHospital
    ? [selectedHospital.location.latitude, selectedHospital.location.longitude]
    : null;

  return (
    <AppShell
      userRole="AMBULANCE"
      userName={`${ambulance.name} (${ambulance.vehicleNumber})`}
      connectionState={realtimeService.getConnectionState()}
      gpsState={gpsEnabled ? 'active' : (gpsError ? 'unavailable' : 'acquiring')}
      gpsAccuracy={currentAccuracy}
      gpsTimestamp={gpsTimestamp}
    >
      <div className="flex flex-col h-full overflow-hidden relative">

        {/* ── Map ── */}
        <div className="flex-1 relative min-h-0 bg-bg-main">
          {gpsError && !baseLocation && (
            <div className="absolute inset-0 z-[2000] bg-[#0F1218]/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-[#E53935]/10 flex items-center justify-center mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#E53935" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
              <h2 className="text-xl font-black text-white tracking-wider mb-2">GPS UNAVAILABLE</h2>
              <p className="text-sm text-text-secondary max-w-md">{gpsError}</p>
              <p className="text-xs text-text-muted mt-4 font-bold tracking-widest uppercase">Please enable location services to find nearby hospitals.</p>
            </div>
          )}
          
          <MapView 
            center={baseLocation || [0, 0]} 
            zoom={15} 
            showLiveLocation={false}
          >
            <HospitalSearchPanel
              hospitals={filteredHospitals}
              loading={loadingHospitals}
              error={hospitalError}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSelect={handleSearchSelect}
              selectedHospitalId={selectedHospital?.id}
              radiusKm={radiusKm}
              onRadiusChange={setRadiusKm}
            />

            <HospitalPins 
              hospitals={filteredHospitals}
              selectedHospitalId={selectedHospital?.id}
              onSelect={handleSearchSelect}
            />

            <AmbulanceGPSMarker
              ambulance={ambulance}
              isSOS={!!activeIncident}
              followLiveLocation={followLiveLocation}
              onLocationUpdate={handleLocationUpdate}
            />

            {destinationPos && selectedHospital && (
              <HospitalMarker
                position={destinationPos}
                name={selectedHospital.name}
                address={selectedHospital.address}
                availableIcuBeds={selectedHospital.availableIcuBeds}
                traumaBaysAvailable={selectedHospital.traumaBaysAvailable}
                phone={selectedHospital.phone}
              />
            )}

            {(() => {
              // Prefer routeInfo (live navigation) over static incident route
              let pts = routeInfo?.polyline || activeIncident?.route_geometry || [];
              if (typeof pts === 'string') {
                try { pts = JSON.parse(pts); } catch (e) { /* ignore */ }
              }
              if (pts.length > 0) {
                return (
                  <RoutePolyline
                    positions={pts}
                    congestionSegments={routeInfo?.congestionSegments || []}
                    active={!!activeIncident}
                  />
                );
              }
              return null;
            })()}
          </MapView>

          {/* SOS INFORMATION OVERLAY */}
          {activeIncident && (
            <SOSInformationPanel
              incident={activeIncident}
              navigationStatus={navigationStatus}
              onAbort={handleAbort}
              onComplete={handleComplete}
            />
          )}

          {/* Floating Action / Hospital Panel at Bottom Right */}
          <div className="absolute bottom-6 right-6 z-[1000] flex flex-col gap-4 items-end pointer-events-none">
            {/* Checkbox */}
            <div className="bg-bg-surface/90 backdrop-blur border border-border-subtle rounded-lg px-3 py-2 pointer-events-auto shadow-lg">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={followLiveLocation}
                  onChange={(e) => setFollowLiveLocation(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-bg-surface text-[#35C7FF] focus:ring-[#35C7FF]/50"
                />
                <span className="text-xs font-bold text-gray-300">Follow Ambulance</span>
              </label>
            </div>

            {/* Selected Hospital Card with SOS */}
            {selectedHospital && !activeIncident && (
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-[350px] max-w-[calc(100vw-3rem)] rounded-xl bg-bg-main border border-border-subtle overflow-hidden shadow-xl flex flex-col pointer-events-auto"
              >
                <div className="p-4 flex flex-col gap-3">
                  <div>
                    <h4 className="text-lg font-bold text-white">{selectedHospital.name}</h4>
                    <p className="text-xs text-text-secondary mt-0.5 line-clamp-1">{selectedHospital.address}</p>
                  </div>
                  
                  <div className="pt-2">
                    <SOSController
                      hospital={selectedHospital}
                      ambulanceId={ambulance.id}
                      currentPos={currentLiveLocation.current || baseLocation || [0, 0]}
                      patientData={{ category, priority, chiefComplaint: `${category} — ${priority}` }}
                      onEmergencyActive={(emergency) => {
                        if (emergency.route) {
                          setRouteInfo({
                            polyline: emergency.route.polyline,
                            distanceMeters: emergency.route.distanceMeters,
                            etaSeconds: emergency.route.etaSeconds,
                            steps: emergency.route.steps || [],
                          });
                          lastRouteCalculationTime.current = Date.now();
                          setNavigationStatus('active');
                        }
                      }} 
                    />
                  </div>
                </div>
              </motion.div>
            )}
            
          </div>
        </div>
      </div>
    </AppShell>
  );
}
