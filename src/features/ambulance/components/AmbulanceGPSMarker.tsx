import { useEffect, useState, useRef } from 'react';
import { useMappls } from '../../../components/map/MapplsContext';
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
  const { map } = useMappls();
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

    map.addListener('mousedown', handleStart);
    map.addListener('touchstart', handleStart);
    map.addListener('dragstart', handleStart);
    map.addListener('zoomstart', handleStart);

    map.addListener('mouseup', handleEnd);
    map.addListener('touchend', handleEnd);
    map.addListener('dragend', handleEnd);
    map.addListener('zoomend', handleEnd);

    return () => {
      map.removeListener('mousedown', handleStart);
      map.removeListener('touchstart', handleStart);
      map.removeListener('dragstart', handleStart);
      map.removeListener('zoomstart', handleStart);

      map.removeListener('mouseup', handleEnd);
      map.removeListener('touchend', handleEnd);
      map.removeListener('dragend', handleEnd);
      map.removeListener('zoomend', handleEnd);
    };
  }, [map]);

  useEffect(() => {
    if (!gpsLocation) return;
    const currentPos: [number, number] = [gpsLocation.latitude, gpsLocation.longitude];

    // Emit back to parent only if moved significantly (e.g., > 1 meters) to avoid thrashing
    // But we also need updates for speed, so emit if it's the first time or location changed.
    if (!lastEmittedPos.current || 
        Math.abs(lastEmittedPos.current[0] - currentPos[0]) > 0.00001 || 
        Math.abs(lastEmittedPos.current[1] - currentPos[1]) > 0.00001) {
      lastEmittedPos.current = currentPos;
      if (onLocationUpdate) onLocationUpdate(gpsLocation);
    }

    // Handle map panning internally
    // Do not pan if user is actively interacting with the map to prevent breaking zoom/pan animations
    if (followLiveLocation && !isInteracting.current && map) {
      if (isFirstUpdate.current) {
        map.setCenter({ lat: currentPos[0], lng: currentPos[1] });
        isFirstUpdate.current = false;
      } else {
        // Just center
        map.setCenter({ lat: currentPos[0], lng: currentPos[1] });
      }
    }
  }, [gpsLocation, followLiveLocation, map, onLocationUpdate]);

  if (!gpsLocation) return null;

  return (
    <AmbulanceMarker
      position={[gpsLocation.latitude, gpsLocation.longitude]}
      label={ambulance.name}
      speedKmH={gpsLocation.speed != null ? (gpsLocation.speed * 3.6) : undefined}
      vehicleNumber={ambulance.vehicleNumber}
      isSOS={isSOS}
    />
  );
}
