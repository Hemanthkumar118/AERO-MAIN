import { memo, useEffect, useRef } from 'react';
import { renderToString } from 'react-dom/server';
import type { NormalizedHospital } from '../../../services/hospitalSearch/types';
import { useGoogleMap } from '../../../components/map/GoogleMapContext';
import { MarkerClusterer, Cluster } from '@googlemaps/markerclusterer';

interface HospitalPinsProps {
  hospitals: NormalizedHospital[];
  selectedHospitalId?: string;
  onSelect: (hospital: NormalizedHospital) => void;
}

const BLUE_ICON_HTML = `
  <div style="display:flex; justify-content:center; align-items:center;">
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22s14-12.667 14-22C28 6.268 21.732 0 14 0z"
        fill="#3b82f6" stroke="white" stroke-width="1.5"/>
      <circle cx="14" cy="14" r="7" fill="white" opacity="0.9"/>
      <text x="14" y="18" text-anchor="middle" font-size="10" fill="#3b82f6" font-weight="bold" font-family="sans-serif">H</text>
    </svg>
  </div>
`;

// Custom renderer for AERO theme
const aeroClusterRenderer = {
  render: ({ count, position }: Cluster, _stats: any, _map: google.maps.Map) => {
    const content = document.createElement('div');
    content.style.width = '42px';
    content.style.height = '42px';
    content.style.backgroundColor = '#3b82f6';
    content.style.color = 'white';
    content.style.borderRadius = '50%';
    content.style.display = 'flex';
    content.style.justifyContent = 'center';
    content.style.alignItems = 'center';
    content.style.fontWeight = 'bold';
    content.style.fontSize = '15px';
    content.style.border = '3px solid white';
    content.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    content.innerText = String(count);

    return new google.maps.marker.AdvancedMarkerElement({
      position,
      content,
      zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count,
    });
  }
};

export const HospitalPins = memo(function HospitalPins({
  hospitals,
  selectedHospitalId,
  onSelect,
}: HospitalPinsProps) {
  const { map } = useGoogleMap();
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  
  // Use a ref for onSelect so we don't have to re-create markers on every render
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Setup clusterer and info window once
  useEffect(() => {
    if (!map) return;

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow({
        maxWidth: 300,
      });
    }

    if (!clustererRef.current) {
      clustererRef.current = new MarkerClusterer({
        map,
        markers: [],
        renderer: aeroClusterRenderer,
      });
    }

    return () => {
      if (clustererRef.current) {
        clustererRef.current.clearMarkers();
        clustererRef.current = null;
      }
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
        infoWindowRef.current = null;
      }
      markersRef.current.forEach(m => {
        m.map = null;
        google.maps.event.clearInstanceListeners(m);
      });
      markersRef.current = [];
    };
  }, [map]);

  // Update markers when hospitals change
  useEffect(() => {
    if (!map || !clustererRef.current || !infoWindowRef.current) return;

    // Filter out the selected hospital (rendered separately by parent)
    const visibleHospitals = hospitals.filter(h => h.id !== selectedHospitalId);

    // Deduplicate by ID
    const uniqueHospitals = Array.from(
      new Map(visibleHospitals.map(h => [h.id, h])).values()
    );

    // Clear old markers
    clustererRef.current.clearMarkers();
    markersRef.current.forEach(m => {
      m.map = null;
      google.maps.event.clearInstanceListeners(m);
    });
    markersRef.current = [];

    const newMarkers = uniqueHospitals.map(hospital => {
      const contentEl = document.createElement('div');
      contentEl.innerHTML = BLUE_ICON_HTML;
      contentEl.style.width = '28px';
      contentEl.style.height = '36px';
      contentEl.style.cursor = 'pointer';

      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: hospital.lat, lng: hospital.lng },
        content: contentEl,
      });

      marker.addListener('click', () => {
        onSelectRef.current(hospital);

        if (map) {
          map.setCenter({ lat: hospital.lat, lng: hospital.lng });
          map.setZoom(15);
        }

        const distKm = ((hospital as any).drivingDistanceMeters
          ? (hospital as any).drivingDistanceMeters
          : (hospital.distanceMeters ?? 0)) / 1000;

        const popupContent = (
          <div className="font-sans p-1 min-w-[180px]">
            <p className="font-bold text-sm text-gray-900">{hospital.name}</p>
            {hospital.address && (
              <p className="text-xs text-gray-500 mt-0.5 leading-tight">
                {hospital.address.slice(0, 60)}
              </p>
            )}

            {hospital.provider === 'google' && (
              <span className="text-[9px] font-bold text-gray-400">SOURCE: GOOGLE PLACES</span>
            )}
            {hospital.provider === 'osm' && (
              <span className="text-[9px] font-bold text-gray-400">SOURCE: OSM / OVERPASS</span>
            )}
            {hospital.provider === 'merged' && (
              <span className="text-[9px] font-bold text-[#10b981]">
                SOURCE: VERIFIED (GOOGLE + OSM)
              </span>
            )}

            <div className="flex items-center justify-between mt-2">
              <span className="text-xs bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full">
                {distKm.toFixed(1)} km
              </span>
              <button
                className="text-xs bg-emerald-600 text-white font-bold px-3 py-1 rounded-lg hover:bg-emerald-500 cursor-pointer"
              >
                Route
              </button>
            </div>
          </div>
        );

        const popupHtmlDep = renderToString(<div className="aero-custom-popup">{popupContent}</div>);
        infoWindowRef.current?.setContent(popupHtmlDep);
        infoWindowRef.current?.open({ anchor: marker, map });
      });

      return marker;
    });

    markersRef.current = newMarkers;
    clustererRef.current.addMarkers(newMarkers);
  }, [map, hospitals, selectedHospitalId]);

  return null;
});
