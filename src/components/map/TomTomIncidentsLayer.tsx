import { useEffect, useState, useRef, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import { useTomTomMap } from './TomTomMapContext';
import { trafficService } from '../../services/trafficService';
import type { TomTomIncident } from '../../types';

interface TomTomIncidentsLayerProps {
  enabled?: boolean;
  center?: [number, number]; // [lat, lng]
  radiusKm?: number;
  onSelectIncident?: (incident: TomTomIncident) => void;
  onError?: (error: string) => void;
  onCountChange?: (count: number) => void;
}

export function TomTomIncidentsLayer({
  enabled = true,
  center,
  radiusKm = 15,
  onSelectIncident,
  onError,
  onCountChange,
}: TomTomIncidentsLayerProps) {
  const { map } = useTomTomMap();
  const [incidents, setIncidents] = useState<TomTomIncident[]>([]);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const isFetchingRef = useRef(false);

  const clearMapObjects = useCallback(() => {
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
  }, []);

  const fetchIncidents = useCallback(async () => {
    if (!enabled || isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const lat = center ? center[0] : 17.44;
      const lng = center ? center[1] : 78.34;
      const data = await trafficService.getTomTomIncidents({ lat, lng, radiusKm });
      setIncidents(data);
      if (onCountChange) onCountChange(data.length);
    } catch (err: any) {
      console.warn('[TomTomIncidentsLayer] Error fetching incidents:', err);
      if (onError) onError(err.message || 'Failed to fetch TomTom incidents');
    } finally {
      isFetchingRef.current = false;
    }
  }, [enabled, center, radiusKm, onCountChange, onError]);

  // Initial and periodic fetch
  useEffect(() => {
    if (!enabled) {
      clearMapObjects();
      setIncidents([]);
      if (onCountChange) onCountChange(0);
      return;
    }

    fetchIncidents();
    const interval = setInterval(fetchIncidents, 60000); // 60s update

    return () => clearInterval(interval);
  }, [enabled, fetchIncidents, clearMapObjects, onCountChange]);

  // Render incident markers on MapLibre map
  useEffect(() => {
    if (!map || !enabled || incidents.length === 0) {
      clearMapObjects();
      return;
    }

    clearMapObjects();

    const getIconDetails = (cat: string) => {
      switch (cat.toLowerCase()) {
        case 'accident':
          return { emoji: '💥', bg: '#ef4444', border: '#b91c1c' };
        case 'road closed':
          return { emoji: '⛔', bg: '#dc2626', border: '#991b1b' };
        case 'traffic jam':
          return { emoji: '🚗', bg: '#f97316', border: '#c2410c' };
        case 'road works':
          return { emoji: '🚧', bg: '#eab308', border: '#a16207' };
        case 'flooding':
        case 'fog hazard':
        case 'dangerous conditions':
          return { emoji: '⚠️', bg: '#eab308', border: '#a16207' };
        default:
          return { emoji: '⚠️', bg: '#f97316', border: '#c2410c' };
      }
    };

    const newMarkers: maplibregl.Marker[] = [];

    incidents.slice(0, 50).forEach(incident => {
      const { emoji, bg, border } = getIconDetails(incident.category);

      const el = document.createElement('div');
      el.className = 'aero-tomtom-incident-marker';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.gap = '4px';
      el.style.cursor = 'pointer';

      const delayBadge = (incident.delayMinutes && incident.delayMinutes > 0)
        ? `<span style="background: rgba(15, 23, 42, 0.85); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 9999px; white-space: nowrap; font-family: monospace;">+${incident.delayMinutes}m</span>`
        : '';

      el.innerHTML = `
        <div style="width: 28px; height: 28px; border-radius: 50%; background: ${bg}; border: 2px solid ${border}; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3); font-size: 14px;">
          ${emoji}
        </div>
        ${delayBadge}
      `;

      try {
        const popup = new maplibregl.Popup({
          offset: 20,
          maxWidth: '300px',
          closeButton: true,
          className: 'aero-maplibre-popup'
        }).setHTML(`
          <div style="padding: 10px; font-family: sans-serif; color: #f1f5f9;">
            <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: #f59e0b; text-transform: uppercase;">
              <span>${emoji}</span>
              <span>${incident.category}</span>
            </div>
            <div style="font-size: 13px; font-weight: 700; color: #ffffff; margin-top: 4px;">
              ${incident.description || 'Traffic Incident'}
            </div>
            ${incident.from ? `<div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">From: ${incident.from}</div>` : ''}
            ${incident.to ? `<div style="font-size: 11px; color: #94a3b8;">To: ${incident.to}</div>` : ''}
            <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid #334155; display: flex; justify-content: space-between; font-size: 11px;">
              <span style="color: #94a3b8;">Severity: <strong style="color: ${incident.severity === 'blocking' ? '#ef4444' : '#eab308'};">${incident.severity}</strong></span>
              ${(incident.delayMinutes ?? 0) > 0 ? `<span style="color: #ef4444; font-weight: 700;">+${incident.delayMinutes}m delay</span>` : ''}
            </div>
          </div>
        `);

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([incident.location.longitude, incident.location.latitude])
          .setPopup(popup)
          .addTo(map);

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (onSelectIncident) {
            onSelectIncident(incident);
          }
        });

        newMarkers.push(marker);
      } catch (err) {
        console.error('[TomTomIncidentsLayer] Error creating marker:', err);
      }
    });

    markersRef.current = newMarkers;

    return () => {
      newMarkers.forEach(m => m.remove());
      markersRef.current = [];
    };
  }, [map, enabled, incidents, onSelectIncident]);

  return null;
}
