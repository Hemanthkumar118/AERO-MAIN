import { useEffect, useRef } from 'react';
import type { CongestionSegment } from '../../types';
import { useTomTomMap } from './TomTomMapContext';

interface RoutePolylineProps {
  positions: [number, number][]; // [lat, lng]
  active?: boolean;
  congestionSegments?: CongestionSegment[];
}

const CONGESTION_COLORS: Record<string, string> = {
  green: '#10b981',  // Free flow
  yellow: '#eab308', // Minor delay
  orange: '#f97316', // Moderate congestion
  red: '#ef4444',    // Heavy / Gridlock
};

export function RoutePolyline({
  positions,
  active = true,
  congestionSegments,
}: RoutePolylineProps) {
  const { map } = useTomTomMap();
  const sourceIdRef = useRef(`aero-route-${Math.random().toString(36).substring(2, 7)}`);
  const congestionSourceIdRef = useRef(`aero-cong-${Math.random().toString(36).substring(2, 7)}`);

  useEffect(() => {
    if (!map || !positions || positions.length < 2) return;

    const sourceId = sourceIdRef.current;
    const casingLayerId = `${sourceId}-casing`;
    const glowLayerId = `${sourceId}-glow`;
    const baseLayerId = `${sourceId}-base`;

    const congSourceId = congestionSourceIdRef.current;
    const congLayerId = `${congSourceId}-layer`;

    // Coordinates in MapLibre format: [lng, lat]
    const coordinates = positions.map(([lat, lng]) => [lng, lat]);

    const cleanup = () => {
      try {
        if (!map) return;
        if (map.getLayer(congLayerId)) map.removeLayer(congLayerId);
        if (map.getSource(congSourceId)) map.removeSource(congSourceId);

        if (map.getLayer(baseLayerId)) map.removeLayer(baseLayerId);
        if (map.getLayer(glowLayerId)) map.removeLayer(glowLayerId);
        if (map.getLayer(casingLayerId)) map.removeLayer(casingLayerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch (e) {
        // Map may have already been destroyed
      }
    };

    cleanup();

    try {
      // 1. Add Main Route Source
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates,
          },
        },
      });

      // 2. Add Crisp Contrasting Outer Casing (Google Maps style casing for light map)
      map.addLayer({
        id: casingLayerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#ffffff',
          'line-width': 10,
          'line-opacity': 0.95,
        },
      });

      // 3. Add Base Solid Route Line
      map.addLayer({
        id: baseLayerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': active ? '#dc2626' : '#2563eb',
          'line-width': 6,
          'line-opacity': 0.95,
        },
      });

      // 4. Add Live Traffic Congestion Segments
      if (congestionSegments && congestionSegments.length > 0) {
        const segmentFeatures = congestionSegments
          .filter(seg => seg.polyline && seg.polyline.length >= 2)
          .map((seg, idx) => ({
            type: 'Feature' as const,
            id: idx,
            properties: {
              color: CONGESTION_COLORS[seg.level] || '#10b981',
              level: seg.level,
            },
            geometry: {
              type: 'LineString' as const,
              coordinates: seg.polyline.map(([lat, lng]) => [lng, lat]),
            },
          }));

        if (segmentFeatures.length > 0) {
          map.addSource(congSourceId, {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: segmentFeatures,
            },
          });

          map.addLayer({
            id: congLayerId,
            type: 'line',
            source: congSourceId,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': ['get', 'color'],
              'line-width': 6,
              'line-opacity': 0.95,
            },
          });
        }
      }

      // 5. Fit Map Bounds to Route
      const lngs = coordinates.map(c => c[0]);
      const lats = coordinates.map(c => c[1]);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);

      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: 80,
          duration: 1200,
          maxZoom: 16,
        }
      );
    } catch (err) {
      console.error('[RoutePolyline] Error adding route layers:', err);
    }

    return cleanup;
  }, [map, positions, active, congestionSegments]);

  return null;
}
