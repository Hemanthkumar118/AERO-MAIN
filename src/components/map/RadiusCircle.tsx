import { useEffect, useRef } from 'react';
import { useTomTomMap } from './TomTomMapContext';

interface RadiusCircleProps {
  center: [number, number]; // [lat, lng]
  radiusMeters: number;
}

function createGeoJSONCircle(center: [number, number], radiusInKm: number, points = 64) {
  const coords = {
    latitude: center[0],
    longitude: center[1],
  };

  const km = radiusInKm;
  const ret: [number, number][] = [];
  const distanceX = km / (111.32 * Math.cos((coords.latitude * Math.PI) / 180));
  const distanceY = km / 110.574;

  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    ret.push([coords.longitude + x, coords.latitude + y]);
  }
  ret.push(ret[0]); // Close ring

  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [ret],
    },
  };
}

export function RadiusCircle({ center, radiusMeters }: RadiusCircleProps) {
  const { map } = useTomTomMap();
  const sourceIdRef = useRef(`aero-circle-${Math.random().toString(36).substring(2, 7)}`);

  useEffect(() => {
    if (!map || !center) return;

    const sourceId = sourceIdRef.current;
    const fillLayerId = `${sourceId}-fill`;
    const lineLayerId = `${sourceId}-line`;

    const circleData = createGeoJSONCircle(center, radiusMeters / 1000);

    const cleanup = () => {
      try {
        if (!map) return;
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch (e) {
        // Map might have been disposed
      }
    };

    cleanup();

    try {
      map.addSource(sourceId, {
        type: 'geojson',
        data: circleData,
      });

      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#38bdf8',
          'fill-opacity': 0.1,
        },
      });

      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#38bdf8',
          'line-width': 1.5,
          'line-opacity': 0.6,
          'line-dasharray': [3, 2],
        },
      });
    } catch (err) {
      console.error('[RadiusCircle] Error adding circle:', err);
    }

    return cleanup;
  }, [map, center[0], center[1], radiusMeters]);

  return null;
}
