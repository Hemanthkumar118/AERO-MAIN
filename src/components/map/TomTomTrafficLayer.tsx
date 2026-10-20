import { useEffect, useRef } from 'react';
import { useTomTomMap } from './TomTomMapContext';
import { TrafficFlowModule } from '@tomtom-org/maps-sdk/map';

interface TomTomTrafficLayerProps {
  enabled?: boolean;
  opacity?: number;
  style?: 'relative' | 'relative0' | 'absolute' | 'relative-delay';
  refreshIntervalMs?: number;
  onError?: (error: string) => void;
  onLoaded?: () => void;
}

export function TomTomTrafficLayer({
  enabled = true,
  opacity = 0.85,
  style = 'relative',
  onError,
  onLoaded,
}: TomTomTrafficLayerProps) {
  const { map, tomtomMap } = useTomTomMap();
  const flowModuleRef = useRef<any>(null);
  const sourceId = 'aero-tomtom-traffic-flow-raster';
  const layerId = 'aero-tomtom-traffic-flow-raster-layer';

  useEffect(() => {
    if (!map) return;

    const apiKey = import.meta.env.VITE_TOMTOM_API_KEY;
    if (!apiKey) {
      if (onError) onError('TomTom API key not configured');
      return;
    }

    // Try TomTomMap vector traffic flow module first if tomtomMap is present
    if (tomtomMap) {
      TrafficFlowModule.get(tomtomMap, { visible: enabled })
        .then(mod => {
          flowModuleRef.current = mod;
          mod.setVisible(enabled);
          if (onLoaded) onLoaded();
        })
        .catch(err => {
          console.warn('[TomTomTrafficLayer] Vector flow module fallback to raster:', err);
          // Fallback to raster tiles
          setupRasterTraffic();
        });
      return;
    }

    function setupRasterTraffic() {
      if (!map) return;
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);

        if (!enabled) return;

        map.addSource(sourceId, {
          type: 'raster',
          tiles: [
            `https://api.tomtom.com/traffic/map/4/tile/flow/${style}/{z}/{x}/{y}.png?key=${apiKey}`
          ],
          tileSize: 256,
        });

        map.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: {
            'raster-opacity': opacity,
          },
        });

        if (onLoaded) onLoaded();
      } catch (err: any) {
        console.error('[TomTomTrafficLayer] Raster tile error:', err);
        if (onError) onError(err.message || 'Failed to render TomTom traffic');
      }
    }

    setupRasterTraffic();

    return () => {
      try {
        if (map) {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        }
      } catch (e) {}
    };
  }, [map, tomtomMap, enabled, opacity, style]);

  useEffect(() => {
    if (flowModuleRef.current) {
      try {
        flowModuleRef.current.setVisible(enabled);
      } catch (e) {}
    }
  }, [enabled]);

  return null;
}
