import { useEffect, useRef } from 'react';
import { useGoogleMap } from './GoogleMapContext';

interface RadiusCircleProps {
  center: [number, number];
  radiusMeters: number;
}

export function RadiusCircle({ center, radiusMeters }: RadiusCircleProps) {
  const { map } = useGoogleMap();
  const circleRef = useRef<google.maps.Circle | null>(null);

  useEffect(() => {
    if (!map) return;

    if (!circleRef.current) {
      circleRef.current = new window.google.maps.Circle({
        map,
        center: { lat: center[0], lng: center[1] },
        radius: radiusMeters,
        strokeColor: '#4285F4',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: '#4285F4',
        fillOpacity: 0.1,
        clickable: false
      });
    } else {
      circleRef.current.setCenter({ lat: center[0], lng: center[1] });
      circleRef.current.setRadius(radiusMeters);
    }

    return () => {
      // Don't unmount it if it's just a re-render. We clean it up when component unmounts.
    };
  }, [map, center[0], center[1], radiusMeters]);

  useEffect(() => {
    return () => {
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
    };
  }, []);

  return null;
}
