import { useEffect, useState, useRef } from 'react';
import { useTomTomMap } from '../../../components/map/TomTomMapContext';
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
  onLocationUpdate?: (pos: [number, number]) => void;
}

/**
 * Handles its own GPS subscription so that the parent map/dashboard
 * doesn't need to re-render hospital markers every time the GPS ticks.
 */
export function AmbulanceGPSMarker({
  ambulance,
  isSOS,
  followLiveLocation,
  onLocationUpdate,
}: AmbulanceGPSMarkerProps) {
  const { map } = useTomTomMap();
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

    const startEvents = ['mousedown', 'touchstart', 'dragstart'];
    const endEvents = ['mouseup', 'touchend', 'dragend'];

    startEvents.forEach(evt => map.on(evt as any, handleStart));
    endEvents.forEach(evt => map.on(evt as any, handleEnd));

    return () => {
      startEvents.forEach(evt => map.off(evt as any, handleStart));
      endEvents.forEach(evt => map.off(evt as any, handleEnd));
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
      if (onLocationUpdate) onLocationUpdate(currentPos);
    }

    // Handle map panning internally
    if (followLiveLocation && !isInteracting.current && map) {
      if (isFirstUpdate.current) {
        map.setCenter([currentPos[1], currentPos[0]]);
        isFirstUpdate.current = false;
      } else {
        map.panTo([currentPos[1], currentPos[0]], { duration: 600 });
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
