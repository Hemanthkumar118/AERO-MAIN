import { useEffect, useRef } from 'react';
import type { CongestionSegment } from '../../types';
import { useMappls } from './MapplsContext';

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
  const { map, mapplsClassObject } = useMappls();
  const outerLineRef = useRef<any>(null);
  const baseLineRef = useRef<any>(null);
  const congestionLinesRef = useRef<any[]>([]);
  const mainLineRef = useRef<any>(null);
  const pulseLineRef = useRef<any>(null);

  // Color mapping for traffic congestion
  const congestionColors: Record<string, string> = {
    green: '#10b981', // Smooth flow (40-60 km/h)
    yellow: '#eab308', // Moderate (25-40 km/h)
    orange: '#f97316', // Heavy (10-25 km/h)
    red: '#ef4444', // Gridlock (< 10 km/h)
  };

  useEffect(() => {
    if (!map || !mapplsClassObject || !positions || positions.length < 2) return;

    const path = positions.map(pos => ({ lat: pos[0], lng: pos[1] }));

    // Cleanup previous lines
    const cleanup = () => {
      if (outerLineRef.current) outerLineRef.current.remove();
      if (baseLineRef.current) baseLineRef.current.remove();
      congestionLinesRef.current.forEach(line => line.remove());
      congestionLinesRef.current = [];
      if (mainLineRef.current) mainLineRef.current.remove();
      if (pulseLineRef.current) pulseLineRef.current.remove();
    };
    
    cleanup();

    const createPolyline = (options: any) => {
      return new (mapplsClassObject as any).Polyline({
        map: map,
        path: options.path || path,
        strokeColor: options.strokeColor,
        strokeOpacity: options.strokeOpacity,
        strokeWeight: options.strokeWeight,
        lineCap: 'round',
        lineJoin: 'round',
        strokeDashstyle: options.strokeDashstyle,
      });
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
        strokeDashstyle: active ? undefined : 'dash',
      });
    }

    if (active) {
      // Mappls SDK doesn't natively support animating dashed lines easily without direct mapbox gl integration.
      // But we can add a basic dashed line on top.
      pulseLineRef.current = createPolyline({
        strokeColor: '#ffffff',
        strokeWeight: 2,
        strokeOpacity: 0.8,
        strokeDashstyle: 'dash',
      });
    }

    return cleanup;
  }, [map, mapplsClassObject, positions, active, congestionSegments]);

  return null;
}
