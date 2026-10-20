import { useState, useEffect, useRef } from 'react';
import { AppShell } from '../../../components/layout/AppShell';
import {
  MapView,
  HospitalMarker,
  RoutePolyline,
} from '../../../components/map';
import { AmbulanceGPSMarker } from '../components/AmbulanceGPSMarker';
import { HospitalSearchPanel } from '../components/HospitalSearchPanel';
import { HospitalPins } from '../components/HospitalPins';
import { AmbulanceNavigationPanel } from '../components/AmbulanceNavigationPanel';
import { SOSInformationPanel } from '../components/SOSInformationPanel';
import { ClinicalAssessmentModal } from '../components/ClinicalAssessmentModal';
import { realtimeService } from '../../../services/realtimeService';
import { routingService } from '../../../services/routingService';
import { TrafficAwareRoutingProvider } from '../../../services/TrafficAwareRoutingProvider';
import { geolocationService } from '../../../services/geolocationService';
import { discoverHospitals } from '../../../services/hospitalSearch';
import type { NormalizedHospital } from '../../../services/hospitalSearch/types';
import type {
  EmergencyIncident,
  Hospital,
} from '../../../types';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../providers/AuthProvider';

export function AmbulanceDashboard() {
  const { user, profile } = useAuth();
  const [ambulance] = useState({
    id: user?.id || 'unknown-id',
    name: profile?.full_name || 'Ambulance Operator',
    vehicleNumber: profile?.organization || 'Unknown Vehicle',
    heading: 0,
    speedKmH: 0,
  });

  // Base Map State (initialized once or on major shifts, avoids micro-rerenders)
  const [baseLocation, setBaseLocation] = useState<[number, number] | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [lastGpsTimestamp, setLastGpsTimestamp] = useState<number | null>(null);

  // Hospital & Routing state
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [loadingHospitals, setLoadingHospitals] = useState(false);
  const [hospitalResults, setHospitalResults] = useState<NormalizedHospital[]>([]);
  const [selectedHospital, setSelectedHospital] = useState<Hospital | null>(null);
  const [routeInfo, setRouteInfo] = useState<any | null>(null);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [selectedAlternativeIndex, setSelectedAlternativeIndex] = useState(0);
  const [showClinicalModal, setShowClinicalModal] = useState(false);
  // Centralized Route & Traffic Calculation
  const calculateRouteForHospital = async (
    hosp: Hospital, 
    originCoords?: [number, number] | null,
    forceRefresh: boolean = false
  ) => {
    const origin = originCoords || currentLiveLocation.current || baseLocation;
    if (!origin) return;

    if (routingLoading && !forceRefresh) return;
    setRoutingLoading(true);
    setRoutingError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const destCoords: [number, number] = [hosp.location.latitude, hosp.location.longitude];
      const route = await TrafficAwareRoutingProvider.getFastestRoute(origin, destCoords);
      clearTimeout(timeoutId);

      if (route && route.polyline && route.polyline.length > 0) {
        setRouteInfo(route);
        setSelectedAlternativeIndex(0);
        lastRouteCalculationTime.current = Date.now();
        setNavigationStatus(activeIncident ? 'active' : 'idle');
      } else {
        setRouteInfo(null);
        setRoutingError('Route could not be calculated. Try another hospital.');
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.warn('[AERO ROUTING] Route calculation failed:', err.message);
      setRoutingError(err.message || 'Failed to fetch live route. Tap retry.');
    } finally {
      setRoutingLoading(false);
    }
  };

  const handleSelectAlternative = (index: number) => {
    setSelectedAlternativeIndex(index);
    if (routeInfo && routeInfo.alternatives && routeInfo.alternatives[index]) {
      const selectedAlt = routeInfo.alternatives[index];
      setRouteInfo({
        ...routeInfo,
        polyline: selectedAlt.polyline,
        distanceMeters: selectedAlt.distanceMeters,
        etaSeconds: selectedAlt.durationSeconds,
        trafficAwareEtaSeconds: selectedAlt.durationSeconds,
        trafficDelaySeconds: selectedAlt.trafficDelaySeconds || 0,
      });
    }
  };

  
  // Navigation State
  const [navigationStatus, setNavigationStatus] = useState<'idle' | 'active' | 'rerouting' | 'arrived' | 'error'>('idle');
  const currentLiveLocation = useRef<[number, number] | null>(null);
  const lastRouteCalculationTime = useRef<number>(0);
  const isRouting = useRef(false);

  // UI state
  const [followLiveLocation, setFollowLiveLocation] = useState(true);

  // Emergency State
  const [activeIncident, setActiveIncident] = useState<EmergencyIncident | null>(null);

  const locationUpdateInterval = useRef<any>(null);
  const currentAccuracy = 5;

  // 1. Initialize Realtime Services
  useEffect(() => {
    // Check initial active incident
    const fetchInitial = async () => {
      const { data } = await supabase
        .from('emergency_incidents')
        .select('*')
        .eq('ambulance_id', ambulance.id)
        .in('status', ['active', 'dispatched', 'en_route'])
        .maybeSingle();
      if (data) setActiveIncident(data as EmergencyIncident);
    };
    fetchInitial();

    const unsub = realtimeService.on('incidents_updated', (incidents: EmergencyIncident[]) => {
      const myActive = incidents.find(inc => ['active', 'dispatched', 'en_route'].includes(inc.status) && inc.ambulance_id === ambulance.id);
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
        setGpsEnabled(true);
        setGpsError(null);
        setLastGpsTimestamp(Date.now());
      })
      .catch(err => {
        setGpsError(err.message || 'GPS denied or unavailable');
        setGpsEnabled(false);
      });
      
    // Start tracking in the background. AmbulanceGPSMarker will listen directly.
    geolocationService.startWatching();
    return () => geolocationService.stopWatching();
  }, []);

  // Sync GPS to Supabase actively if emergency is active (bypassing React state)
  useEffect(() => {
    if (activeIncident) {
      if (locationUpdateInterval.current) clearInterval(locationUpdateInterval.current);
      
      locationUpdateInterval.current = setInterval(() => {
        geolocationService.getCurrentPosition().then(pos => {
          supabase.from('emergency_incidents').update({
            current_latitude: pos.latitude,
            current_longitude: pos.longitude,
            current_speed: (pos.speed || 0) * 3.6,
            current_heading: (pos as any).heading || 0,
          }).eq('id', activeIncident.id).then(({ error }: any) => {
            if (error) console.error("Failed to sync GPS to Supabase:", error);
          });
        }).catch(() => {});
      }, 5000); // Throttled
    } else {
      if (locationUpdateInterval.current) {
        clearInterval(locationUpdateInterval.current);
        locationUpdateInterval.current = null;
      }
    }

    return () => {
      if (locationUpdateInterval.current) clearInterval(locationUpdateInterval.current);
    };
  }, [activeIncident?.id]);

  // Monotonic sequence reference to prevent stale responses from overwriting active radius
  const searchSeqRef = useRef(0);

  // 3. Auto-discover Hospitals
  useEffect(() => {
    if (!baseLocation || activeIncident) return;

    const currentSeq = ++searchSeqRef.current;
    const abortController = new AbortController();

    const fetchAndRankHospitals = async () => {
      setLoadingHospitals(true);

      try {
        const { results } = await discoverHospitals(
          baseLocation[0],
          baseLocation[1],
          radiusKm * 1000,
          false,
          abortController.signal
        );

        if (currentSeq !== searchSeqRef.current) return; // Ignore stale response

        if (results.length > 0) {
          const ranked = await routingService.rankHospitalsByTravelTime(baseLocation, results);
          if (currentSeq !== searchSeqRef.current) return;

          setHospitalResults(ranked);

          // Retain selected hospital if still in results, otherwise pick nearest
          setSelectedHospital(prev => {
            if (prev && ranked.some(h => h.id === prev.id)) {
              return prev;
            }
            const best = ranked[0];
            const autoHosp: any = {
              id: best.id,
              name: best.name,
              address: best.address || best.name,
              location: { latitude: best.lat, longitude: best.lng },
              phone: best.phone || '',
              emergencyCapable: true,
              totalBeds: 0,
              availableIcuBeds: 0,
              traumaBaysAvailable: 0,
              doctorsOnDuty: 0,
              distanceKm: parseFloat(((best as any).drivingDistanceMeters / 1000).toFixed(1)),
              drivingEtaSeconds: (best as any).drivingEtaSeconds
            };
            calculateRouteForHospital(autoHosp, baseLocation);
            return autoHosp;
          });
        } else {
          if (currentSeq === searchSeqRef.current) setHospitalResults([]);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError' && currentSeq === searchSeqRef.current) {
          console.warn('[HospitalSearch]', err);
        }
      } finally {
        if (currentSeq === searchSeqRef.current) {
          setLoadingHospitals(false);
        }
      }
    };

    fetchAndRankHospitals();
    return () => {
      abortController.abort();
    };
  }, [baseLocation, radiusKm, activeIncident]);

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
    calculateRouteForHospital(hosp, currentLiveLocation.current || baseLocation);
  };

  // Live Location Update & Off-Route Detection
  const handleLocationUpdate = async (pos: [number, number]) => {
    currentLiveLocation.current = pos;
    setLastGpsTimestamp(Date.now());
    
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
      
      if (distToRoute > 100 && !isRouting.current && navigationStatus !== 'arrived') {
        const now = Date.now();
        // Debounce rerouting by 10 seconds to avoid spamming router
        if (now - lastRouteCalculationTime.current > 10000) {
          isRouting.current = true;
          setNavigationStatus('rerouting');
          
          try {
             if (dest) {
               const newRoute = await TrafficAwareRoutingProvider.getFastestRoute(pos, dest);
               if (newRoute && newRoute.polyline.length > 0) {
                 setRouteInfo(newRoute);
                 setNavigationStatus('active');
                 lastRouteCalculationTime.current = Date.now();

                  if (activeIncident) {
                    const updatePayload: any = {
                      route_geometry: newRoute.polyline,
                      route_distance_meters: newRoute.distanceMeters,
                      route_duration_seconds: newRoute.etaSeconds,
                      traffic_duration_seconds: newRoute.trafficAwareEtaSeconds || newRoute.etaSeconds,
                      traffic_status: newRoute.trafficStatus || (newRoute.isTrafficAware ? 'LIVE' : 'UNAVAILABLE'),
                      route_version: (activeIncident.route_version || 1) + 1,
                      last_reroute_at: new Date().toISOString(),
                    };
                    if (newRoute.routeProvider) {
                      updatePayload.route_provider = newRoute.routeProvider;
                    }
                    supabase.from('emergency_incidents').update(updatePayload).eq('id', activeIncident.id).then(async ({ error }: { error: any }) => {
                      if (error && (error.message?.includes('route_provider') || error.code === 'PGRST204')) {
                        delete updatePayload.route_provider;
                        await supabase.from('emergency_incidents').update(updatePayload).eq('id', activeIncident.id);
                      } else if (error) {
                        console.warn('[AERO ROUTING] Failed to sync reroute to DB:', error);
                      }
                    });
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

  const currentGpsState: import('../../../types').GPSState = (() => {
    if (gpsError?.toLowerCase().includes('denied') || (gpsError as any)?.code === 1) return 'permission_denied';
    if (gpsError) return 'unavailable';
    if (!gpsEnabled || !baseLocation) return 'acquiring';
    if (lastGpsTimestamp && Date.now() - lastGpsTimestamp > 60000) return 'stale';
    return 'active';
  })();

  return (
    <AppShell
      userRole="AMBULANCE"
      userName={`${ambulance.name} (${ambulance.vehicleNumber})`}
      connectionState={realtimeService.getConnectionState()}
      gpsState={currentGpsState}
      gpsAccuracy={currentAccuracy}
      gpsTimestamp={lastGpsTimestamp ? new Date(lastGpsTimestamp) : null}
    >
      <div className="flex flex-col h-full overflow-hidden relative">

        {/* ── Map ── */}
        <div className="flex-1 relative min-h-0 bg-slate-100">
          <MapView 
            center={baseLocation || [17.44, 78.34]} 
            zoom={15} 
            showLiveLocation={false}
          >
            <HospitalSearchPanel
              hospitals={hospitalResults}
              loading={loadingHospitals}
              onSelect={handleSearchSelect}
              selectedHospitalId={selectedHospital?.id}
              radiusKm={radiusKm}
              onRadiusChange={setRadiusKm}
              centerLocation={baseLocation || [17.44, 78.34]}
              gpsEnabled={gpsEnabled}
            />

            <HospitalPins 
              hospitals={hospitalResults}
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
              routeInfo={routeInfo}
              onAbort={handleAbort}
              onComplete={handleComplete}
              onOpenClinicalAssessment={() => setShowClinicalModal(true)}
            />
          )}

          {/* CLINICAL ASSESSMENT MODAL */}
          {showClinicalModal && activeIncident && (
            <ClinicalAssessmentModal
              isOpen={showClinicalModal}
              incidentId={activeIncident.id}
              ambulanceId={ambulance.id}
              destinationHospital={activeIncident.destination_hospital || selectedHospital?.name}
              onClose={() => setShowClinicalModal(false)}
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

            {/* Google Maps-Style Live Navigation Panel */}
            {selectedHospital && !activeIncident && (
              <AmbulanceNavigationPanel
                hospital={selectedHospital}
                ambulanceId={ambulance.id}
                currentPos={currentLiveLocation.current || baseLocation || [17.44, 78.34]}
                routeInfo={routeInfo}
                loading={routingLoading}
                error={routingError}
                onRefresh={() => calculateRouteForHospital(selectedHospital, currentLiveLocation.current || baseLocation, true)}
                onSelectAlternative={handleSelectAlternative}
                selectedAlternativeIndex={selectedAlternativeIndex}
                onEmergencyActive={(emergency) => {
                  if (emergency.route) {
                    setRouteInfo(emergency.route);
                    lastRouteCalculationTime.current = Date.now();
                    setNavigationStatus('active');
                  }
                }}
                onCancelDestination={() => {
                  if (!activeIncident) {
                    setSelectedHospital(null);
                    setRouteInfo(null);
                  }
                }}
              />
            )}
            
          </div>
        </div>
      </div>
    </AppShell>
  );
}
