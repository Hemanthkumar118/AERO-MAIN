import { useEffect, useState, useRef } from 'react';
import { useGoogleMap } from '../../../components/map/GoogleMapContext';
import { AmbulanceMarker } from '../../../components/map';
import { geolocationService, type GeoLocationResult } from '../../../services/geolocationService';

interface AmbulanceGPSMarkerProps {
  ambulance: {
    name: string;
    vehicleNumber: string;
    heading: number;
    speedKmH: number;
  };
  isSOS: boolean;
  followLiveLocation: boolean;
  onLocationUpdate?: (pos: GeoLocationResult) => void;
}

/**
 * Handles its own GPS subscription so that the parent map/dashboard
 * doesn't need to re-render 1,000+ hospital markers every time the GPS ticks.
 */
export function AmbulanceGPSMarker({
  ambulance,
  isSOS,
  followLiveLocation,
  onLocationUpdate
}: AmbulanceGPSMarkerProps) {
  const { map } = useGoogleMap();
  const [gpsLocation, setGpsLocation] = useState<GeoLocationResult | null>(null);
  const isFirstUpdate = useRef(true);
  const lastEmittedPos = useRef<[number, number] | null>(null);

  useEffect(() => {
    // Initial fetch
    geolocationService.getCurrentPosition().then(pos => {
      setGpsLocation(pos);
    }).catch(() => {});

    // Subscribe to live updates
    const unwatch = geolocationService.onUpdate((pos) => {
      setGpsLocation(pos);
    });

    return () => {
      unwatch();
    };
  }, []);

  const isInteracting = useRef(false);

  useEffect(() => {
    if (!map) return;
    
    const handleStart = () => { isInteracting.current = true; };
    const handleEnd = () => { isInteracting.current = false; };

    const events = ['mousedown', 'touchstart', 'dragstart'];
    const endEvents = ['mouseup', 'touchend', 'dragend'];

    events.forEach(event => map.addListener(event, handleStart));
    endEvents.forEach(event => map.addListener(event, handleEnd));

    return () => {
      // Google Maps listeners are cleaned up when the map is destroyed
    };
  }, [map]);

  useEffect(() => {
    if (!gpsLocation) return;
    const currentPos: [number, number] = [gpsLocation.latitude, gpsLocation.longitude];

    // Emit back to parent only if moved significantly (e.g., > 1 meters) to avoid thrashing
    if (!lastEmittedPos.current || 
        Math.abs(lastEmittedPos.current[0] - currentPos[0]) > 0.00001 || 
        Math.abs(lastEmittedPos.current[1] - currentPos[1]) > 0.00001) {
      lastEmittedPos.current = currentPos;
      if (onLocationUpdate) onLocationUpdate(gpsLocation);
    }

    // Handle map panning internally
    if (followLiveLocation && !isInteracting.current && map) {
      if (isFirstUpdate.current) {
        map.setCenter({ lat: currentPos[0], lng: currentPos[1] });
        isFirstUpdate.current = false;
      } else {
        map.setCenter({ lat: currentPos[0], lng: currentPos[1] });
      }
    }
  }, [gpsLocation, followLiveLocation, map, onLocationUpdate]);

  if (!gpsLocation) return null;

  return (
    <AmbulanceMarker
      position={[gpsLocation.latitude, gpsLocation.longitude]}
      heading={(gpsLocation as any).heading ?? ambulance.heading ?? 0}
      label={ambulance.name}
      speedKmH={gpsLocation.speed != null ? (gpsLocation.speed * 3.6) : undefined}
      vehicleNumber={ambulance.vehicleNumber}
      isSOS={isSOS}
    />
  );
}
