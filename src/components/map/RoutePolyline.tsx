import { useEffect, useRef } from 'react';
import type { GeoJSONSource } from 'maplibre-gl';
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
  const sourceIdRef = useRef('aero-live-route');
  const congestionSourceIdRef = useRef('aero-live-cong');
  const lastFittedRouteKey = useRef<string>('');

  // Unmount cleanup ONLY: tear down layers and sources when unmounting
  useEffect(() => {
    return () => {
      try {
        if (!map) return;
        const sourceId = sourceIdRef.current;
        const congSourceId = congestionSourceIdRef.current;
        const casingLayerId = `${sourceId}-casing`;
        const glowLayerId = `${sourceId}-glow`;
        const baseLayerId = `${sourceId}-base`;
        const congLayerId = `${congSourceId}-layer`;

        if (map.getLayer(congLayerId)) map.removeLayer(congLayerId);
        if (map.getSource(congSourceId)) map.removeSource(congSourceId);
        if (map.getLayer(baseLayerId)) map.removeLayer(baseLayerId);
        if (map.getLayer(glowLayerId)) map.removeLayer(glowLayerId);
        if (map.getLayer(casingLayerId)) map.removeLayer(casingLayerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch (e) {}
    };
  }, [map]);

  useEffect(() => {
    if (!map || !positions || positions.length < 2) return;

    const sourceId = sourceIdRef.current;
    const casingLayerId = `${sourceId}-casing`;
    const baseLayerId = `${sourceId}-base`;

    const congSourceId = congestionSourceIdRef.current;
    const congLayerId = `${congSourceId}-layer`;

    // Coordinates in MapLibre format: [lng, lat]
    const len = positions.length;
    const coordinates: [number, number][] = new Array(len);
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    for (let i = 0; i < len; i++) {
      const lat = positions[i][0];
      const lng = positions[i][1];
      coordinates[i] = [lng, lat];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    const routeGeoJson: any = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates,
      },
    };

    const existingSource = map.getSource(sourceId) as GeoJSONSource | undefined;

    if (existingSource) {
      // 1. Efficient In-place Data Update (Zero layer teardown)
      try {
        existingSource.setData(routeGeoJson);

        // Update color dynamically if active toggled
        if (map.getLayer(baseLayerId)) {
          map.setPaintProperty(baseLayerId, 'line-color', active ? '#dc2626' : '#2563eb');
        }

        // Update congestion segments if present
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

          const existingCongSource = map.getSource(congSourceId) as GeoJSONSource | undefined;
          if (existingCongSource) {
            existingCongSource.setData({
              type: 'FeatureCollection',
              features: segmentFeatures,
            });
          }
        }
      } catch (err) {
        console.warn('[RoutePolyline] setData notice:', err);
      }
    } else {
      // 2. Initial Setup: Create Layers Once
      try {
        map.addSource(sourceId, {
          type: 'geojson',
          data: routeGeoJson,
        });

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
      } catch (err) {
        console.error('[RoutePolyline] Error adding route layers:', err);
      }
    }

    // Fit bounds only when route start/end significantly changes
    const routeKey = `${coordinates[0]?.[0].toFixed(3)},${coordinates[0]?.[1].toFixed(3)}-${coordinates[coordinates.length - 1]?.[0].toFixed(3)},${coordinates[coordinates.length - 1]?.[1].toFixed(3)}`;
    if (lastFittedRouteKey.current !== routeKey) {
      lastFittedRouteKey.current = routeKey;

      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: 80,
          duration: 1000,
          maxZoom: 16,
        }
      );
    }
  }, [map, positions, active, congestionSegments]);

  return null;
}
