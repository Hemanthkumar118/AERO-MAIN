import { useState, useEffect, useRef } from 'react';
import { mappls } from 'mappls-web-maps';
import { MapplsContext } from './MapplsContext';

interface MapViewProps {
  center: [number, number];
  zoom?: number;
  children?: React.ReactNode;
  className?: string;
  showControls?: boolean;
  showLiveLocation?: boolean;
  followLiveLocation?: boolean;
}

export function MapView({
  center,
  zoom = 14,
  children,
  className = '',
  showControls = true,
  showLiveLocation = true,
  followLiveLocation = false,
}: MapViewProps) {
  console.log("[MapView] COMPONENT MOUNTED", Date.now());

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const mapplsClassObject = useRef(new mappls());
  const uniqueId = useRef(`mappls-map-${Math.random().toString(36).substr(2, 9)}`);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  // Live location tracker marker
  const liveLocationMarker = useRef<any>(null);
  const hasInitialCentered = useRef(false);

  useEffect(() => {
    const mapplsKey = import.meta.env.VITE_MAPPLS_KEY;
    console.log("[MapView] MAPPLS KEY:", mapplsKey ? "CONFIGURED" : "MISSING");
    if (!mapplsKey) {
      console.error("VITE_MAPPLS_KEY is not defined");
      return;
    }

    let isMounted = true;
    
    // Clear any existing map instance to be safe
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const loadObject = {
      map: true,
      version: '3.0'
    };

    try {
      console.log("[MapView] Attempting to initialize Mappls with key:", mapplsKey.substring(0, 5) + "...");
      mapplsClassObject.current.initialize(mapplsKey, loadObject, () => {
        console.log("[MapView] Mappls initialize callback executed.");
        if (!isMounted) {
            console.log("[MapView] Component unmounted before map could initialize.");
            return;
        }
        const mapContainer = document.getElementById(uniqueId.current);
        if (!mapContainer) {
            console.error("[MapView] mapContainer not found in DOM!");
            return;
        }
        
        console.log("[MapView] mapContainer found. Instantiating map...");
        // Clear container just in case
        mapContainer.innerHTML = '';

        // If center is exactly 0,0, default to India's center (Nagpur) to avoid black ocean tiles
        const safeCenter = (center[0] === 0 && center[1] === 0) 
            ? [28.6139, 77.2090] // New Delhi fallback
            : [center[0], center[1]];

        const newMap = mapplsClassObject.current.Map({
          id: uniqueId.current,
          properties: {
            center: safeCenter,
            zoom: zoom,
            zoomControl: false,
            location: false
          },
        });

        console.log("[MapView] Map instance created. Waiting for 'load' event...");

        newMap.on("load", () => {
          console.log("[MapView] Map 'load' event fired!");
          if (isMounted) setIsMapLoaded(true);
        });
        
        newMap.on("error", (err: any) => {
            console.error("[MapView] Map SDK threw an error:", err);
        });

        mapRef.current = newMap;
      });
    } catch (err) {
      console.error("Failed to initialize Mappls map:", err);
    }

    return () => {
      isMounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update center when prop changes
  useEffect(() => {
    if (isMapLoaded && mapRef.current) {
      mapRef.current.setCenter([center[0], center[1]]);
    }
  }, [center[0], center[1], isMapLoaded]);

  // Live Location Tracker
  useEffect(() => {
    if (!showLiveLocation || !isMapLoaded || !('geolocation' in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const newPos = [pos.coords.latitude, pos.coords.longitude];

        if (!liveLocationMarker.current) {
          liveLocationMarker.current = new (mapplsClassObject.current as any).Marker({
            map: mapRef.current,
            position: { lat: newPos[0], lng: newPos[1] },
            html: `
              <div style="display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;">
                <div style="width: 14px; height: 14px; background-color: #4285F4; border-radius: 50%; border: 2.5px solid #ffffff; box-shadow: 0 0 10px rgba(66, 133, 244, 0.6);"></div>
              </div>
            `,
            width: 24,
            height: 24,
            offset: [12, 12]
          });
        } else {
          liveLocationMarker.current.setPosition({ lat: newPos[0], lng: newPos[1] });
        }

        if (followLiveLocation && !hasInitialCentered.current) {
          mapRef.current.setCenter([newPos[0], newPos[1]]);
          mapRef.current.setZoom(Math.max(mapRef.current.getZoom(), 16));
          hasInitialCentered.current = true;
        } else if (followLiveLocation) {
          mapRef.current.setCenter([newPos[0], newPos[1]]);
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

  const [childCount, setChildCount] = useState(0);
  const [networkStatus, setNetworkStatus] = useState<string>("TESTING...");
  
  useEffect(() => {
    const interval = setInterval(() => {
      const el = document.getElementById(uniqueId.current);
      if (el) setChildCount(el.childNodes.length);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Explicitly test the Mappls script URL to see if it's returning 403 Forbidden
    const testUrl = `https://apis.mappls.com/advancedmaps/api/${import.meta.env.VITE_MAPPLS_KEY}/map_sdk?layer=vector&v=3.0`;
    fetch(testUrl)
      .then(res => setNetworkStatus(`HTTP ${res.status} ${res.statusText}`))
      .catch(err => setNetworkStatus(`FAILED TO FETCH: ${err.message}`));
  }, []);

  return (
    <div className={`relative w-full h-full min-h-[300px] bg-bg-main overflow-hidden ${className}`}>
      
      {/* EXTREMELY VISIBLE DEBUG TEXT FOR USER TO VERIFY CODE IS UPDATED */}
      {!isMapLoaded && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[9999] bg-white p-4 text-black font-black text-lg border-4 border-red-500 shadow-2xl pointer-events-none w-3/4 max-w-lg text-left">
          <div>1. COMPONENT MOUNTED: YES</div>
          <div>2. VITE_MAPPLS_KEY: {import.meta.env.VITE_MAPPLS_KEY ? "FOUND" : "MISSING"}</div>
          <div>3. IS_MAP_LOADED: FALSE</div>
          <div>4. MAP_REF_EXISTS: {mapRef.current ? "YES" : "NO"}</div>
          <div>5. CONTAINER_CHILDREN: {childCount} nodes</div>
          <div className="mt-2 text-red-600">6. NETWORK TEST: {networkStatus}</div>
          {networkStatus.includes("401") || networkStatus.includes("403") ? (
            <div className="mt-2 text-sm text-red-700 bg-red-100 p-2">
              ERROR: Mappls is rejecting your API Key or Domain (localhost:5174). 
              Check your Mappls Dashboard for domain restrictions.
            </div>
          ) : null}
        </div>
      )}

      <div id={uniqueId.current} ref={mapContainerRef} className="w-full h-full z-0 bg-[#0a0e1a]" />

      {isMapLoaded && (
        <MapplsContext.Provider value={{ map: mapRef.current, mapplsClassObject: mapplsClassObject.current }}>
          {children}
        </MapplsContext.Provider>
      )}

      {/* Bottom Left Floating Controls */}
      {showControls && (
        <div className="absolute bottom-4 left-4 z-[400] flex flex-col gap-2 pointer-events-auto">
          <button
            onClick={() => {
              if (mapRef.current) {
                mapRef.current.setCenter([center[0], center[1]]);
              }
            }}
            className="w-9 h-9 bg-white/90 backdrop-blur border border-gray-200 rounded-lg flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-white transition-colors shadow-md cursor-pointer pointer-events-auto"
            title="Recenter Map"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          </button>
          
          <div className="flex flex-col gap-1">
            <button
              onClick={() => mapRef.current && mapRef.current.setZoom(mapRef.current.getZoom() + 1)}
              className="w-9 h-9 bg-white/90 backdrop-blur border border-gray-200 rounded-lg flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-white transition-colors shadow-md cursor-pointer font-bold text-lg"
              title="Zoom In"
            >
              +
            </button>
            <button
              onClick={() => mapRef.current && mapRef.current.setZoom(mapRef.current.getZoom() - 1)}
              className="w-9 h-9 bg-white/90 backdrop-blur border border-gray-200 rounded-lg flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-white transition-colors shadow-md cursor-pointer font-bold text-lg"
              title="Zoom Out"
            >
              −
            </button>
          </div>
          
          <button
            onClick={() => setShowLegend(!showLegend)}
            className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-colors shadow-md cursor-pointer text-xs font-bold ${
              showLegend 
                ? 'bg-primary-600 text-white border-primary-500' 
                : 'bg-white/90 backdrop-blur border-gray-200 text-gray-500 hover:text-gray-900'
            }`}
            title="Toggle Map Legend"
          >
            🗺️
          </button>
        </div>
      )}

      {/* Map Legend Overlay */}
      {showLegend && (
        <div className="absolute bottom-16 left-16 z-[400] bg-white/95 backdrop-blur border border-gray-200 rounded-xl p-3.5 shadow-lg text-xs max-w-xs animate-fade-in">
          <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-gray-200">
            <span className="font-bold text-gray-800 uppercase tracking-wider text-[11px]">Map Legend</span>
            <button onClick={() => setShowLegend(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-[#FF3B30] flex items-center justify-center text-[10px]">🚑</div>
              <span className="text-gray-700 font-medium">Emergency Ambulance (Live)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-red-700 flex items-center justify-center text-[10px]">🏥</div>
              <span className="text-gray-700 font-medium">Destination Hospital</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-sky-600 flex items-center justify-center text-[10px]">👮</div>
              <span className="text-gray-700 font-medium">Traffic Police Officer</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-white"></div>
              </div>
              <span className="text-gray-700 font-medium">Your Live Location</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-emerald-300" />
              <span className="text-gray-600">Cleared Green-Wave Junction</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-500 ring-2 ring-amber-300" />
              <span className="text-gray-600">Preparing Junction Clearance</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-orange-500 flex items-center justify-center text-[9px]">⚠️</span>
              <span className="text-gray-600">Hazard / Road Blockage</span>
            </div>
          </div>
        </div>
      )}

      {/* Police-Assisted System Notice */}
      <div className="absolute bottom-2 right-4 z-[400] pointer-events-none">
        <span className="text-[10px] text-gray-400 bg-white/80 px-2 py-0.5 rounded border border-gray-200 font-mono">
          Police-Assisted Traffic Clearance • Mappls
        </span>
      </div>
    </div>
  );
}


