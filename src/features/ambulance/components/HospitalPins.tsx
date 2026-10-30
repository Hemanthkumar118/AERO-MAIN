import { memo, useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { NormalizedHospital } from '../../../services/hospitalSearch/types';
import { useTomTomMap } from '../../../components/map/TomTomMapContext';

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

const GEOJSON_SOURCE_ID = 'aero-hospitals-geojson';
const CLUSTERS_LAYER_ID = 'aero-hospitals-clusters';
const CLUSTER_COUNT_LAYER_ID = 'aero-hospitals-cluster-count';
const UNCLUSTERED_LAYER_ID = 'aero-hospitals-unclustered';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getHospitalPopupHtml(hospital: NormalizedHospital, distKm: number): string {
  const phoneSection = hospital.phone
    ? `<div class="flex justify-between"><span class="text-slate-400">Phone:</span><span class="text-slate-200">${escapeHtml(hospital.phone)}</span></div>`
    : '';
  const distLabel = distKm > 0 ? `${distKm.toFixed(1)} km` : 'Calculating...';

  return `<div class="aero-custom-popup">
    <div class="p-2 min-w-[200px]">
      <div class="flex items-center gap-1.5 text-[10px] font-bold text-sky-500 uppercase tracking-wide">
        <span class="w-2 h-2 rounded-full bg-sky-500" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#0284c7;"></span>
        <span>Hospital</span>
      </div>
      <p class="font-bold text-sm text-slate-100 mt-1">${escapeHtml(hospital.name)}</p>
      <p class="text-xs text-slate-400">${escapeHtml(hospital.address || 'Address unavailable')}</p>
      <div class="mt-2 pt-2 border-t border-slate-700/60 space-y-1 text-xs">
        <div class="flex justify-between">
          <span class="text-slate-400">Distance:</span>
          <span class="font-bold text-sky-400">${distLabel}</span>
        </div>
        ${phoneSection}
      </div>
    </div>
  </div>`;
}

interface ActiveMarkerEntry {
  marker: maplibregl.Marker;
  popup: maplibregl.Popup;
  lastDistKm: number;
}

export const HospitalPins = memo(function HospitalPins({
  hospitals,
  selectedHospitalId,
  onSelect,
}: HospitalPinsProps) {
  const { map } = useTomTomMap();
  const markersPoolRef = useRef<Map<string, ActiveMarkerEntry>>(new Map());
  const layersInitializedRef = useRef(false);

  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Teardown all markers on unmount
  useEffect(() => {
    return () => {
      markersPoolRef.current.forEach(entry => entry.marker.remove());
      markersPoolRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!map) return;

    // Filter out the selected hospital (rendered separately by parent)
    const visibleHospitals = hospitals.filter(h => h.id !== selectedHospitalId);

    // Deduplicate by ID
    const uniqueHospitals = Array.from(
      new Map(visibleHospitals.map(h => [h.id, h])).values()
    );

    // 1. Build GeoJSON FeatureCollection for all hospitals
    const geojsonData: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: uniqueHospitals.map(h => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [h.lng, h.lat]
        },
        properties: {
          id: h.id,
          name: h.name,
          address: h.address || '',
          distanceMeters: h.distanceMeters ?? 0
        }
      }))
    };

    // Helper to add or update MapLibre clustered layers safely
    const setupClusteredLayers = () => {
      try {
        const existingSource = map.getSource(GEOJSON_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        if (existingSource) {
          existingSource.setData(geojsonData);
          return;
        }

        // Add clustered source
        map.addSource(GEOJSON_SOURCE_ID, {
          type: 'geojson',
          data: geojsonData,
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 50
        });

        // Add cluster bubbles
        if (!map.getLayer(CLUSTERS_LAYER_ID)) {
          map.addLayer({
            id: CLUSTERS_LAYER_ID,
            type: 'circle',
            source: GEOJSON_SOURCE_ID,
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': [
                'step',
                ['get', 'point_count'],
                '#0284c7', // 0-19: sky-600
                20,
                '#2563eb', // 20-99: blue-600
                100,
                '#1d4ed8'  // 100+: blue-700
              ],
              'circle-radius': [
                'step',
                ['get', 'point_count'],
                18,
                20,
                22,
                100,
                26
              ],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff'
            }
          });
        }

        // Add cluster text count
        if (!map.getLayer(CLUSTER_COUNT_LAYER_ID)) {
          map.addLayer({
            id: CLUSTER_COUNT_LAYER_ID,
            type: 'symbol',
            source: GEOJSON_SOURCE_ID,
            filter: ['has', 'point_count'],
            layout: {
              'text-field': '{point_count_abbreviated}',
              'text-font': ['Noto Sans Regular', 'Open Sans Regular', 'Arial Unicode MS Regular'],
              'text-size': 12
            },
            paint: {
              'text-color': '#ffffff'
            }
          });
        }

        // Add unclustered hospital dots for points beyond top DOM markers
        if (!map.getLayer(UNCLUSTERED_LAYER_ID)) {
          map.addLayer({
            id: UNCLUSTERED_LAYER_ID,
            type: 'circle',
            source: GEOJSON_SOURCE_ID,
            filter: ['!', ['has', 'point_count']],
            paint: {
              'circle-color': '#0284c7',
              'circle-radius': 6,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff'
            }
          });
        }

        if (!layersInitializedRef.current) {
          layersInitializedRef.current = true;

          // Cluster click to zoom in
          map.on('click', CLUSTERS_LAYER_ID, (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: [CLUSTERS_LAYER_ID] });
            if (!features.length) return;
            const clusterId = features[0].properties?.cluster_id;
            const source = map.getSource(GEOJSON_SOURCE_ID) as maplibregl.GeoJSONSource;
            if (source && clusterId) {
              source.getClusterExpansionZoom(clusterId).then((zoom: number) => {
                const geometry = features[0].geometry as Point;
                map.easeTo({
                  center: geometry.coordinates as [number, number],
                  zoom: zoom + 0.5,
                  duration: 500
                });
              }).catch(() => {});
            }
          });

          // Unclustered point click to select
          map.on('click', UNCLUSTERED_LAYER_ID, (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: [UNCLUSTERED_LAYER_ID] });
            if (!features.length) return;
            const clickedId = features[0].properties?.id;
            const clickedHosp = uniqueHospitals.find(h => h.id === clickedId);
            if (clickedHosp) {
              onSelectRef.current(clickedHosp);
            }
          });

          // Pointer cursor on hover
          const setPointer = () => { map.getCanvas().style.cursor = 'pointer'; };
          const resetPointer = () => { map.getCanvas().style.cursor = ''; };
          map.on('mouseenter', CLUSTERS_LAYER_ID, setPointer);
          map.on('mouseleave', CLUSTERS_LAYER_ID, resetPointer);
          map.on('mouseenter', UNCLUSTERED_LAYER_ID, setPointer);
          map.on('mouseleave', UNCLUSTERED_LAYER_ID, resetPointer);
        }
      } catch (err) {
        console.warn('[HospitalPins] Clustered layer setup warning:', err);
      }
    };

    if (map.isStyleLoaded()) {
      setupClusteredLayers();
    } else {
      map.once('load', setupClusteredLayers);
    }

    // 2. High-performance DOM Marker Pooling (diffing instead of full teardown)
    const closestHospitals = uniqueHospitals.slice(0, 15);
    const targetIds = new Set(closestHospitals.map(h => h.id));
    const currentPool = markersPoolRef.current;

    // Remove markers that are no longer in the top 15
    for (const [id, entry] of currentPool.entries()) {
      if (!targetIds.has(id)) {
        entry.marker.remove();
        currentPool.delete(id);
      }
    }

    // Update existing or create new markers
    closestHospitals.forEach(hospital => {
      const distKm = ((hospital as any).drivingDistanceMeters
        ? (hospital as any).drivingDistanceMeters
        : (hospital.distanceMeters ?? 0)) / 1000;

      const existing = currentPool.get(hospital.id);

      if (existing) {
        // Reuse DOM element, update position and popup if distance changed
        existing.marker.setLngLat([hospital.lng, hospital.lat]);
        if (Math.abs(existing.lastDistKm - distKm) > 0.05) {
          existing.popup.setHTML(getHospitalPopupHtml(hospital, distKm));
          existing.lastDistKm = distKm;
        }
      } else {
        // Create new marker
        const contentEl = document.createElement('div');
        contentEl.innerHTML = BLUE_ICON_HTML;
        contentEl.style.width = '28px';
        contentEl.style.height = '36px';
        contentEl.style.cursor = 'pointer';

        const popup = new maplibregl.Popup({
          offset: 25,
          maxWidth: '300px',
          closeButton: true,
          closeOnClick: false,
          className: 'aero-maplibre-popup'
        }).setHTML(getHospitalPopupHtml(hospital, distKm));

        const marker = new maplibregl.Marker({
          element: contentEl,
        })
          .setLngLat([hospital.lng, hospital.lat])
          .setPopup(popup)
          .addTo(map);

        contentEl.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelectRef.current(hospital);
          map.flyTo({
            center: [hospital.lng, hospital.lat],
            zoom: Math.max(map.getZoom(), 15),
            duration: 1000,
          });
        });

        currentPool.set(hospital.id, {
          marker,
          popup,
          lastDistKm: distKm
        });
      }
    });
  }, [map, hospitals, selectedHospitalId]);

  return null;
});
