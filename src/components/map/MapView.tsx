import { useState, useEffect, useRef, useCallback } from 'react';
import { TomTomMap, type StandardStyleID } from '@tomtom-org/maps-sdk/map';
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import type { Map as MapLibreMap } from 'maplibre-gl';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { TomTomMapContext } from './TomTomMapContext';
import { TomTomTrafficLayer } from './TomTomTrafficLayer';
import { TomTomIncidentsLayer } from './TomTomIncidentsLayer';
import { TrafficLegend } from './TrafficLegend';
import { IncidentDetailModal } from './IncidentDetailModal';
import type { TomTomIncident } from '../../types';

/**
 * Recursively converts a MapLibre text-field expression to prioritize English names
 * ['coalesce', ['get', 'name_en'], ['get', 'name:en'], ['get', 'name']]
 */
function toEnglishTextField(expr: any): any {
  if (expr === '{name}') {
    return ['coalesce', ['get', 'name_en'], ['get', 'name:en'], ['get', 'name']];
  }
  if (Array.isArray(expr)) {
    if (expr.length === 2 && expr[0] === 'get' && expr[1] === 'name') {
      return ['coalesce', ['get', 'name_en'], ['get', 'name:en'], ['get', 'name']];
    }
    return expr.map(sub => toEnglishTextField(sub));
  }
  if (typeof expr === 'string' && expr.includes('{name}')) {
    return ['coalesce', ['get', 'name_en'], ['get', 'name:en'], ['get', 'name']];
  }
  return expr;
}

/**
 * Enforces English-only map labels across all symbol layers on MapLibre map instance
 */
export function enforceEnglishLabels(map: MapLibreMap) {
  if (!map || !map.getStyle) return;
  try {
    const style = map.getStyle();
    if (!style || !style.layers) return;

    for (const layer of style.layers) {
      if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
        const currentField = layer.layout['text-field'];
        const str = JSON.stringify(currentField);
        // Only transform if it hasn't already been converted to prioritize English
        if (!str.includes('name_en')) {
          const updatedField = toEnglishTextField(currentField);
          if (JSON.stringify(updatedField) !== str) {
            try {
              map.setLayoutProperty(layer.id, 'text-field', updatedField);
            } catch (err) {
              console.warn(`[MapView] Failed to enforce English label on layer ${layer.id}:`, err);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[MapView] Error enforcing English labels:', err);
  }
}

interface MapViewProps {
  center: [number, number]; // [lat, lng]
  zoom?: number;
  mapStyle?: StandardStyleID;
  children?: React.ReactNode;
  className?: string;
  showControls?: boolean;
  showLiveLocation?: boolean;
  followLiveLocation?: boolean;
  enableTraffic?: boolean;
  enableIncidents?: boolean;
  onTrafficToggle?: (enabled: boolean) => void;
  onIncidentsToggle?: (enabled: boolean) => void;
}

export function MapView({
  center,
  zoom = 14,
  mapStyle = 'streetLight',
  children,
  className = '',
  showControls = true,
  showLiveLocation = true,
  followLiveLocation = false,
  enableTraffic = true,
  enableIncidents = true,
  onTrafficToggle,
  onIncidentsToggle,
}: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const tomtomMapRef = useRef<TomTomMap | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const uniqueId = useRef(`tomtom-map-${Math.random().toString(36).substr(2, 9)}`);
  
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  // TomTom Traffic & Incident state
  const [showTrafficFlow, setShowTrafficFlow] = useState(enableTraffic);
  const [showIncidents, setShowIncidents] = useState(enableIncidents);
  const [showTrafficLegend, setShowTrafficLegend] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<TomTomIncident | null>(null);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [incidentCount, setIncidentCount] = useState<number>(0);

  // Live location tracker marker
  const liveLocationMarker = useRef<maplibregl.Marker | null>(null);
  const hasInitialCentered = useRef(false);
  const isInitializing = useRef(false);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_TOMTOM_API_KEY;
    if (!apiKey) {
      setTrafficError('TomTom API key not configured. Set VITE_TOMTOM_API_KEY in .env');
      return;
    }

    // Configure global TomTom SDK settings to English
    try {
      TomTomConfig.instance.put({ apiKey, language: 'en-GB' });
    } catch (e) {
      // ignore
    }

    if (isInitializing.current || isMapLoaded || mapRef.current) {
      return;
    }
    isInitializing.current = true;

    const mapContainer = mapContainerRef.current;
    if (!mapContainer) return;

    // Safe center handling (fallback to Hyderabad / India if 0,0)
    const safeCenter = (center[0] === 0 && center[1] === 0)
      ? { lat: 17.4435, lng: 78.3772 }
      : { lat: center[0], lng: center[1] };

    const applyEnglish = (m: MapLibreMap) => {
      enforceEnglishLabels(m);
    };

    try {
      // Initialize modern TomTomMap backed by MapLibre GL with light theme
      const ttMap = new TomTomMap({
        apiKey,
        style: mapStyle,
        language: 'en-GB',
        mapLibre: {
          container: mapContainer,
          center: [safeCenter.lng, safeCenter.lat], // MapLibre uses [lng, lat]
          zoom: zoom || 14,
        },
      } as any);

      tomtomMapRef.current = ttMap;
      const coreMap = ttMap.mapLibreMap;
      mapRef.current = coreMap;
      (window as any).__aeroMap = coreMap;
      (window as any).__aeroTomTom = ttMap;

      try {
        ttMap.setLanguage('en-GB');
      } catch (e) {
        // will apply when map is ready
      }

      coreMap.on('load', () => {
        applyEnglish(coreMap);
        setIsMapLoaded(true);
      });
      coreMap.once('styledata', () => applyEnglish(coreMap));

      // Fallback in case load takes longer or already ready
      setTimeout(() => {
        if (coreMap && !isMapLoaded) {
          applyEnglish(coreMap);
          setIsMapLoaded(true);
        }
      }, 1500);
    } catch (err: any) {
      console.warn('[MapView] Error creating TomTomMap, trying direct MapLibre fallback:', err);
      try {
        const isLight = mapStyle === 'streetLight';
        const mapPart = isLight ? 'basic_street-light' : 'basic_street-dark';
        const flowPart = isLight ? 'flow_relative-light' : 'flow_relative-dark';
        const incPart = isLight ? 'incidents_light' : 'incidents_dark';
        const orbisStyleUrl = `https://api.tomtom.com/maps/orbis/assets/styles/0.6.0-0/style.json?apiVersion=1&key=${apiKey}&map=${mapPart}&trafficFlow=${flowPart}&trafficIncidents=${incPart}`;
        const mlMap = new maplibregl.Map({
          container: mapContainer,
          style: orbisStyleUrl,
          center: [safeCenter.lng, safeCenter.lat],
          zoom: zoom || 14,
          attributionControl: false,
        });

        mapRef.current = mlMap;
        (window as any).__aeroMap = mlMap;

        mlMap.on('load', () => {
          applyEnglish(mlMap);
          setIsMapLoaded(true);
        });
        mlMap.once('styledata', () => applyEnglish(mlMap));
      } catch (fallbackErr: any) {
        console.error('[MapView] Fatal MapLibre initialization error:', fallbackErr);
        setTrafficError(fallbackErr.message || 'Failed to initialize TomTom Maps');
      }
    }

    return () => {
      isInitializing.current = false;
      if (liveLocationMarker.current) {
        liveLocationMarker.current.remove();
        liveLocationMarker.current = null;
      }
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch (e) {}
        mapRef.current = null;
        tomtomMapRef.current = null;
      }
    };
  }, []);

  // Update center when prop changes (with threshold check to prevent tile thrashing)
  useEffect(() => {
    if (isMapLoaded && mapRef.current) {
      const safeCenter = (center[0] === 0 && center[1] === 0)
        ? { lat: 17.4435, lng: 78.3772 }
        : { lat: center[0], lng: center[1] };
      const cur = mapRef.current.getCenter();
      if (cur) {
        const dLat = Math.abs(cur.lat - safeCenter.lat);
        const dLng = Math.abs(cur.lng - safeCenter.lng);
        // Only re-center if change is greater than ~11 meters
        if (dLat > 0.0001 || dLng > 0.0001) {
          mapRef.current.setCenter([safeCenter.lng, safeCenter.lat]);
        }
      } else {
        mapRef.current.setCenter([safeCenter.lng, safeCenter.lat]);
      }
    }
  }, [center[0], center[1], isMapLoaded]);

  // Live Location Tracker
  useEffect(() => {
    if (!showLiveLocation || !isMapLoaded || !('geolocation' in navigator) || !mapRef.current) return;

    const map = mapRef.current;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const newPos: [number, number] = [pos.coords.longitude, pos.coords.latitude];

        if (!liveLocationMarker.current) {
          const dotEl = document.createElement('div');
          dotEl.className = 'aero-live-location-dot';
          dotEl.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;">
              <div style="width: 14px; height: 14px; background-color: #38bdf8; border-radius: 50%; border: 2.5px solid #ffffff; box-shadow: 0 0 12px rgba(56, 189, 248, 0.8);"></div>
            </div>
          `;

          liveLocationMarker.current = new maplibregl.Marker({ element: dotEl })
            .setLngLat(newPos)
            .addTo(map);
        } else {
          liveLocationMarker.current.setLngLat(newPos);
        }

        if (followLiveLocation && !hasInitialCentered.current) {
          map.flyTo({ center: newPos, zoom: Math.max(map.getZoom(), 15), duration: 800 });
          hasInitialCentered.current = true;
        } else if (followLiveLocation) {
          map.panTo(newPos, { duration: 500 });
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (liveLocationMarker.current) {
        liveLocationMarker.current.remove();
        liveLocationMarker.current = null;
      }
    };
  }, [isMapLoaded, showLiveLocation, followLiveLocation]);

  const handleRecenter = useCallback(() => {
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [center[1], center[0]],
        zoom: zoom || 14,
        duration: 1000,
      });
    }
  }, [center[0], center[1], zoom]);

  const handleZoomIn = useCallback(() => {
    if (mapRef.current) mapRef.current.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    if (mapRef.current) mapRef.current.zoomOut();
  }, []);

  const isLight = mapStyle === 'streetLight';

  return (
    <div className={`relative w-full h-full min-h-[300px] ${isLight ? 'bg-[#f8fafc]' : 'bg-[#0F172A]'} overflow-hidden ${className}`}>
      {/* MapLibre / TomTom Canvas Container */}
      <div id={uniqueId.current} ref={mapContainerRef} className={`w-full h-full z-10 ${isLight ? 'bg-[#f8fafc]' : 'bg-[#0F172A]'}`} />

      {/* Traffic Configuration / Network Warning */}
      {trafficError && (
        <div className="absolute top-4 left-4 z-30 bg-red-950/90 border border-red-500/50 text-red-200 text-xs px-3 py-1.5 rounded-lg shadow-xl flex items-center gap-2 max-w-md animate-fade-in pointer-events-auto">
          <span>⚠️ {trafficError}</span>
          <button onClick={() => setTrafficError(null)} className="text-red-400 hover:text-white font-bold ml-auto pl-2">✕</button>
        </div>
      )}

      {/* Incident Detail Card Modal */}
      <IncidentDetailModal
        incident={selectedIncident}
        onClose={() => setSelectedIncident(null)}
      />

      {isMapLoaded && (
        <TomTomMapContext.Provider value={{ map: mapRef.current, tomtomMap: tomtomMapRef.current }}>
          {/* TomTom Real-Time Traffic Flow Layer */}
          <TomTomTrafficLayer
            enabled={showTrafficFlow}
            onError={(err) => setTrafficError(err)}
          />

          {/* TomTom Real-Time Traffic Incidents Layer */}
          <TomTomIncidentsLayer
            enabled={showIncidents}
            center={center}
            onSelectIncident={(inc) => setSelectedIncident(inc)}
            onCountChange={(count) => setIncidentCount(count)}
            onError={(err) => console.warn('[MapView] Incidents error:', err)}
          />

          {children}
        </TomTomMapContext.Provider>
      )}

      {/* Bottom Left Floating Controls */}
      {showControls && (
        <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-2 pointer-events-auto">
          <button
            onClick={handleRecenter}
            className="w-9 h-9 bg-[#0F172A]/90 backdrop-blur-md border border-slate-700/80 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-[#1E293B] transition-colors shadow-lg cursor-pointer pointer-events-auto"
            title="Recenter Map"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          </button>

          <div className="flex flex-col gap-1">
            <button
              onClick={handleZoomIn}
              className="w-9 h-9 bg-[#0F172A]/90 backdrop-blur-md border border-slate-700/80 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-[#1E293B] transition-colors shadow-lg cursor-pointer font-bold text-lg"
              title="Zoom In"
            >
              +
            </button>
            <button
              onClick={handleZoomOut}
              className="w-9 h-9 bg-[#0F172A]/90 backdrop-blur-md border border-slate-700/80 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-[#1E293B] transition-colors shadow-lg cursor-pointer font-bold text-lg"
              title="Zoom Out"
            >
              −
            </button>
          </div>

          {/* TomTom Live Traffic Flow Toggle */}
          <button
            onClick={() => {
              const next = !showTrafficFlow;
              setShowTrafficFlow(next);
              if (onTrafficToggle) onTrafficToggle(next);
            }}
            className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-all shadow-lg cursor-pointer text-xs font-bold ${
              showTrafficFlow
                ? 'bg-emerald-600 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.35)]'
                : 'bg-[#0F172A]/90 backdrop-blur-md border-slate-700/80 text-slate-400 hover:text-slate-200 hover:bg-[#1E293B]'
            }`}
            title={showTrafficFlow ? "TomTom Live Traffic: ON (Click to Hide)" : "TomTom Live Traffic: OFF (Click to Show)"}
          >
            🚦
          </button>

          {/* TomTom Incidents Toggle */}
          <button
            onClick={() => {
              const next = !showIncidents;
              setShowIncidents(next);
              if (onIncidentsToggle) onIncidentsToggle(next);
            }}
            className={`relative w-9 h-9 rounded-lg border flex items-center justify-center transition-all shadow-lg cursor-pointer text-xs font-bold ${
              showIncidents
                ? 'bg-amber-600 text-white border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                : 'bg-[#0F172A]/90 backdrop-blur-md border-slate-700/80 text-slate-400 hover:text-slate-200 hover:bg-[#1E293B]'
            }`}
            title={showIncidents ? `TomTom Incidents: ${incidentCount} Active` : "TomTom Incidents: OFF"}
          >
            ⚠️
            {showIncidents && incidentCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[9px] font-bold px-1 rounded-full min-w-[16px] text-center border border-slate-900 shadow">
                {incidentCount > 99 ? '99+' : incidentCount}
              </span>
            )}
          </button>

          {/* Traffic Legend Toggle */}
          <button
            onClick={() => setShowTrafficLegend(!showTrafficLegend)}
            className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-colors shadow-lg cursor-pointer text-xs font-bold ${
              showTrafficLegend
                ? 'bg-sky-600 text-white border-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.35)]'
                : 'bg-[#0F172A]/90 backdrop-blur-md border-slate-700/80 text-slate-400 hover:text-slate-200 hover:bg-[#1E293B]'
            }`}
            title="Toggle TomTom Traffic Legend"
          >
            📊
          </button>

          {/* Standard Map Legend Toggle */}
          <button
            onClick={() => setShowLegend(!showLegend)}
            className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-colors shadow-lg cursor-pointer text-xs font-bold ${
              showLegend
                ? 'bg-blue-600 text-white border-blue-400 shadow-[0_0_15px_rgba(37,99,235,0.35)]'
                : 'bg-[#0F172A]/90 backdrop-blur-md border-slate-700/80 text-slate-400 hover:text-slate-200 hover:bg-[#1E293B]'
            }`}
            title="Toggle Map Legend"
          >
            🗺️
          </button>
        </div>
      )}

      {/* TomTom Traffic Legend Overlay */}
      {showTrafficLegend && (
        <TrafficLegend
          onClose={() => setShowTrafficLegend(false)}
          showIncidents={showIncidents}
        />
      )}

      {/* Map Legend Overlay */}
      {showLegend && (
        <div className="absolute bottom-16 left-4 z-20 bg-[#0F172A]/95 backdrop-blur-md border border-slate-700/80 rounded-xl p-3 shadow-2xl text-xs space-y-2 pointer-events-auto min-w-[180px] animate-fade-in">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-700/50">
            <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">Map Legend</span>
            <button onClick={() => setShowLegend(false)} className="text-slate-400 hover:text-white font-bold cursor-pointer">✕</button>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
            <span>Emergency Ambulance</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-3 h-3 rounded-full bg-sky-500 shadow-[0_0_6px_rgba(56,189,248,0.6)]" />
            <span>Police Unit</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-3 h-3 rounded-full bg-blue-600 shadow-[0_0_6px_rgba(37,99,235,0.6)]" />
            <span>Hospital Pin</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-3.5 h-1 bg-red-500 rounded" />
            <span>Primary Route</span>
          </div>
        </div>
      )}
    </div>
  );
}
