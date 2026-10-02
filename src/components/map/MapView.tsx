import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleMapContext } from './GoogleMapContext';

interface MapViewProps {
  center: [number, number];
  zoom?: number;
  children?: React.ReactNode;
  className?: string;
  showControls?: boolean;
  showLiveLocation?: boolean;
  followLiveLocation?: boolean;
}

// Google Maps loader singleton
let googleMapsLoadPromise: Promise<void> | null = null;
let googleMapsLoaded = false;

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (googleMapsLoaded) return Promise.resolve();
  if (googleMapsLoadPromise) return googleMapsLoadPromise;

  googleMapsLoadPromise = new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.google?.maps?.Map) {
      googleMapsLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,marker&v=weekly`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      googleMapsLoaded = true;
      resolve();
    };
    script.onerror = () => {
      googleMapsLoadPromise = null;
      reject(new Error('Failed to load Google Maps script'));
    };

    document.head.appendChild(script);
  });

  return googleMapsLoadPromise;
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
  console.log("[MapView] COMPONENT MOUNTED (Google Maps)", Date.now());

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const uniqueId = useRef(`gmap-${Math.random().toString(36).substr(2, 9)}`);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  // Live location tracker marker
  const liveLocationMarker = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const hasInitialCentered = useRef(false);
  const isInitializing = useRef(false);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    console.log("[MapView] GOOGLE MAPS API KEY:", apiKey ? "CONFIGURED" : "MISSING");
    if (!apiKey) {
      console.error("VITE_GOOGLE_MAPS_API_KEY is not defined");
      return;
    }

    if (isInitializing.current || isMapLoaded) {
      console.log("[MapView] Already initializing or loaded. Skipping.");
      return;
    }
    isInitializing.current = true;

    let isMounted = true;

    loadGoogleMapsScript(apiKey).then(() => {
      if (!isMounted) return;

      const mapContainer = document.getElementById(uniqueId.current);
      if (!mapContainer) {
        console.error("[MapView] mapContainer not found in DOM!");
        return;
      }

      console.log("[MapView] Google Maps script loaded. Instantiating map...");

      // If center is exactly 0,0, default to India's center
      const safeCenter = (center[0] === 0 && center[1] === 0)
        ? { lat: 28.6139, lng: 77.2090 } // New Delhi fallback
        : { lat: center[0], lng: center[1] };

      const newMap = new google.maps.Map(mapContainer, {
        center: safeCenter,
        zoom: zoom || 15,
        zoomControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: [
          // Dark emergency dashboard style
          { elementType: 'geometry', stylers: [{ color: '#0a0e1a' }] },
          { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0e1a' }] },
          { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
          { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
          { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
          { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0f1a12' }] },
          { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
          { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a2235' }] },
          { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a2235' }] },
          { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
          { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c3a5a' }] },
          { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
          { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
          { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#111927' }] },
          { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
          { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1117' }] },
          { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
          { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#0d1117' }] },
        ],
        mapId: 'AERO_EMERGENCY_MAP', // Required for AdvancedMarkerElement
      });

      console.log("[MapView] Map instance created.");
      mapRef.current = newMap;

      google.maps.event.addListenerOnce(newMap, 'tilesloaded', () => {
        if (!isMounted) return;
        console.log("[MapView] Map tiles loaded.");
        setIsMapLoaded(true);
      });

      // Fallback in case 'tilesloaded' doesn't fire
      setTimeout(() => {
        if (isMounted && !isMapLoaded) {
          console.log("[MapView] Fallback timeout reached, setting map loaded.");
          setIsMapLoaded(true);
        }
      }, 2000);
    }).catch(err => {
      console.error("Failed to load Google Maps:", err);
    });

    return () => {
      isMounted = false;
      isInitializing.current = false;
      mapRef.current = null;
    };
  }, []);

  // Update center when prop changes
  useEffect(() => {
    if (isMapLoaded && mapRef.current) {
      const safeCenter = (center[0] === 0 && center[1] === 0)
        ? { lat: 28.6139, lng: 77.2090 }
        : { lat: center[0], lng: center[1] };
      mapRef.current.setCenter(safeCenter);
    }
  }, [center[0], center[1], isMapLoaded]);

  // Live Location Tracker
  useEffect(() => {
    if (!showLiveLocation || !isMapLoaded || !('geolocation' in navigator) || !mapRef.current) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };

        if (!liveLocationMarker.current) {
          // Create a blue dot marker for live location
          const dotEl = document.createElement('div');
          dotEl.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;">
              <div style="width: 14px; height: 14px; background-color: #4285F4; border-radius: 50%; border: 2.5px solid #ffffff; box-shadow: 0 0 10px rgba(66, 133, 244, 0.6);"></div>
            </div>
          `;

          liveLocationMarker.current = new google.maps.marker.AdvancedMarkerElement({
            map: mapRef.current,
            position: newPos,
            content: dotEl,
          });
        } else {
          liveLocationMarker.current.position = newPos;
        }

        if (followLiveLocation && !hasInitialCentered.current) {
          mapRef.current!.setCenter(newPos);
          mapRef.current!.setZoom(Math.max(mapRef.current!.getZoom() || 14, 16));
          hasInitialCentered.current = true;
        } else if (followLiveLocation) {
          mapRef.current!.setCenter(newPos);
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (liveLocationMarker.current) {
        liveLocationMarker.current.map = null;
        liveLocationMarker.current = null;
      }
    };
  }, [isMapLoaded, showLiveLocation, followLiveLocation]);

  const handleRecenter = useCallback(() => {
    if (mapRef.current) {
      mapRef.current.setCenter({ lat: center[0], lng: center[1] });
    }
  }, [center[0], center[1]]);

  const handleZoomIn = useCallback(() => {
    if (mapRef.current) mapRef.current.setZoom((mapRef.current.getZoom() || 14) + 1);
  }, []);

  const handleZoomOut = useCallback(() => {
    if (mapRef.current) mapRef.current.setZoom((mapRef.current.getZoom() || 14) - 1);
  }, []);

  return (
    <div className={`relative w-full h-full min-h-[300px] bg-bg-main overflow-hidden ${className}`}>

      <div id={uniqueId.current} ref={mapContainerRef} className="w-full h-full z-10 bg-[#0a0e1a]" />

      {isMapLoaded && (
        <GoogleMapContext.Provider value={{ map: mapRef.current }}>
          {children}
        </GoogleMapContext.Provider>
      )}

      {/* Bottom Left Floating Controls */}
      {showControls && (
        <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-2 pointer-events-auto">
          <button
            onClick={handleRecenter}
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
              onClick={handleZoomIn}
              className="w-9 h-9 bg-white/90 backdrop-blur border border-gray-200 rounded-lg flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-white transition-colors shadow-md cursor-pointer font-bold text-lg"
              title="Zoom In"
            >
              +
            </button>
            <button
              onClick={handleZoomOut}
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
        <div className="absolute bottom-16 left-16 z-20 bg-white/95 backdrop-blur border border-gray-200 rounded-xl p-3.5 shadow-lg text-xs max-w-xs animate-fade-in">
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
      <div className="absolute bottom-2 right-4 z-20 pointer-events-none">
        <span className="text-[10px] text-gray-400 bg-white/80 px-2 py-0.5 rounded border border-gray-200 font-mono">
          Police-Assisted Traffic Clearance • Google Maps
        </span>
      </div>
    </div>
  );
}
