import { useEffect, useRef } from 'react';
import type { CongestionSegment } from '../../types';
import { useGoogleMap } from './GoogleMapContext';

interface RoutePolylineProps {
  positions: [number, number][];
  active?: boolean;
  congestionSegments?: CongestionSegment[];
}

export function RoutePolyline({
  positions,
  active = true,
  congestionSegments,
}: RoutePolylineProps) {
  const { map } = useGoogleMap();
  const outerLineRef = useRef<google.maps.Polyline | null>(null);
  const baseLineRef = useRef<google.maps.Polyline | null>(null);
  const congestionLinesRef = useRef<google.maps.Polyline[]>([]);
  const mainLineRef = useRef<google.maps.Polyline | null>(null);
  const pulseLineRef = useRef<google.maps.Polyline | null>(null);

  // Color mapping for traffic congestion
  const congestionColors: Record<string, string> = {
    green: '#10b981', // Smooth flow (40-60 km/h)
    yellow: '#eab308', // Moderate (25-40 km/h)
    orange: '#f97316', // Heavy (10-25 km/h)
    red: '#ef4444', // Gridlock (< 10 km/h)
  };

  useEffect(() => {
    if (!map || !positions || positions.length < 2) return;

    const path = positions.map(pos => ({ lat: pos[0], lng: pos[1] }));

    // Cleanup previous lines
    const removePolyline = (polyline: google.maps.Polyline | null) => {
      if (polyline) {
        polyline.setMap(null);
      }
    };

    const cleanup = () => {
      removePolyline(outerLineRef.current);
      outerLineRef.current = null;
      removePolyline(baseLineRef.current);
      baseLineRef.current = null;
      congestionLinesRef.current.forEach(line => removePolyline(line));
      congestionLinesRef.current = [];
      removePolyline(mainLineRef.current);
      mainLineRef.current = null;
      removePolyline(pulseLineRef.current);
      pulseLineRef.current = null;
    };

    cleanup();

    const createPolyline = (options: {
      path?: google.maps.LatLngLiteral[];
      strokeColor: string;
      strokeOpacity: number;
      strokeWeight: number;
      isDashed?: boolean;
    }): google.maps.Polyline => {
      const polylineOptions: google.maps.PolylineOptions = {
        map,
        path: options.path || path,
        strokeColor: options.strokeColor,
        strokeOpacity: options.strokeOpacity,
        strokeWeight: options.strokeWeight,
        geodesic: true,
      };

      if (options.isDashed) {
        polylineOptions.strokeOpacity = 0;
        polylineOptions.icons = [
          {
            icon: {
              path: 'M 0,-1 0,1',
              strokeOpacity: options.strokeOpacity || 0.8,
              strokeColor: options.strokeColor,
              scale: options.strokeWeight / 2,
            },
            offset: '0',
            repeat: '12px',
          },
        ];
      }

      return new google.maps.Polyline(polylineOptions);
    };

    // Outer Neon Glow Layer
    outerLineRef.current = createPolyline({
      strokeColor: active ? '#ef4444' : '#94a3b8',
      strokeWeight: 10,
      strokeOpacity: active ? 0.3 : 0.15,
    });

    // Base Solid Route Line
    baseLineRef.current = createPolyline({
      strokeColor: active ? '#1e293b' : '#cbd5e1',
      strokeWeight: 6,
      strokeOpacity: 0.8,
    });

    if (congestionSegments && congestionSegments.length > 0) {
      congestionSegments.forEach((segment) => {
        const segPath = segment.polyline.map(pos => ({ lat: pos[0], lng: pos[1] }));
        const segLine = createPolyline({
          path: segPath,
          strokeColor: congestionColors[segment.level] || '#06b6d4',
          strokeWeight: 4,
          strokeOpacity: 0.95,
        });
        congestionLinesRef.current.push(segLine);
      });
    } else {
      mainLineRef.current = createPolyline({
        strokeColor: active ? '#06b6d4' : '#64748b',
        strokeWeight: 4,
        strokeOpacity: active ? 0.95 : 0.6,
        isDashed: !active,
      });
    }

    if (active) {
      pulseLineRef.current = createPolyline({
        strokeColor: '#ffffff',
        strokeWeight: 2,
        strokeOpacity: 0.8,
        isDashed: true,
      });
    }

    return cleanup;
  }, [map, positions, active, congestionSegments]);

  return null;
}
