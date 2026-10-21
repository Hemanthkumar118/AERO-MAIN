import { useEffect, useRef } from 'react';
import { renderToString } from 'react-dom/server';
import * as maplibregl from 'maplibre-gl';
import { useTomTomMap } from './TomTomMapContext';

export interface TomTomMapMarkerProps {
  position: [number, number]; // [lat, lng]
  html?: string;
  popupContent?: React.ReactNode;
  width?: number;
  height?: number;
  offset?: [number, number];
  onClick?: () => void;
}

export function TomTomMapMarker({
  position,
  html,
  popupContent,
  width,
  height,
  offset,
  onClick,
}: TomTomMapMarkerProps) {
  const { map } = useTomTomMap();
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const popupHtmlDep = popupContent ? renderToString(<div className="aero-custom-popup">{popupContent}</div>) : '';

  // Create and manage MapLibre Marker instance
  useEffect(() => {
    if (!map) return;

    try {
      const el = document.createElement('div');
      if (html) {
        el.innerHTML = html;
      }
      if (width) el.style.width = `${width}px`;
      if (height) el.style.height = `${height}px`;
      el.style.cursor = 'pointer';

      // Create MapLibre Marker
      const marker = new maplibregl.Marker({
        element: el,
        offset: offset ? [offset[0], offset[1]] : undefined,
      })
        .setLngLat([position[1], position[0]]) // MapLibre uses [lng, lat]
        .addTo(map);

      markerRef.current = marker;

      // Attach Popup if content exists
      if (popupHtmlDep) {
        const popup = new maplibregl.Popup({
          offset: 25,
          maxWidth: '320px',
          closeButton: true,
          closeOnClick: false,
          className: 'aero-maplibre-popup'
        }).setHTML(popupHtmlDep);

        marker.setPopup(popup);
        popupRef.current = popup;
      }

      const handleClick = (e: MouseEvent) => {
        e.stopPropagation();
        if (onClick) onClick();
      };
      el.addEventListener('click', handleClick);

      return () => {
        el.removeEventListener('click', handleClick);
        if (popupRef.current) {
          popupRef.current.remove();
          popupRef.current = null;
        }
        marker.remove();
        markerRef.current = null;
      };
    } catch (err) {
      console.error('[TomTomMapMarker] Error creating marker:', err);
    }
  }, [map, html, width, height]);

  // Update popup content in-place without destroying the marker
  useEffect(() => {
    if (popupRef.current && popupHtmlDep) {
      popupRef.current.setHTML(popupHtmlDep);
    } else if (!popupRef.current && popupHtmlDep && markerRef.current) {
      const popup = new maplibregl.Popup({
        offset: 25,
        maxWidth: '320px',
        closeButton: true,
        closeOnClick: false,
        className: 'aero-maplibre-popup'
      }).setHTML(popupHtmlDep);
      markerRef.current.setPopup(popup);
      popupRef.current = popup;
    }
  }, [popupHtmlDep]);

  // Update marker position smoothly
  useEffect(() => {
    if (markerRef.current && position) {
      try {
        markerRef.current.setLngLat([position[1], position[0]]);
      } catch (e) {
        console.error('[TomTomMapMarker] Error updating position:', e);
      }
    }
  }, [position[0], position[1]]);

  return null;
}

// Backwards compatibility alias
export const GoogleMapMarker = TomTomMapMarker;
