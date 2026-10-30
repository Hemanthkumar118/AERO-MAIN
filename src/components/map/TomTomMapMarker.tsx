import { useEffect, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
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

export const TomTomMapMarker = memo(function TomTomMapMarker({
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
  const popupContainerRef = useRef<HTMLDivElement | null>(null);

  if (!popupContainerRef.current) {
    const el = document.createElement('div');
    el.className = 'aero-custom-popup';
    popupContainerRef.current = el;
  }

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
      if (popupContent && popupContainerRef.current) {
        const popup = new maplibregl.Popup({
          offset: 25,
          maxWidth: '320px',
          closeButton: true,
          closeOnClick: false,
          className: 'aero-maplibre-popup'
        }).setDOMContent(popupContainerRef.current);

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

  // Ensure popup is attached or detached if popupContent presence toggles
  useEffect(() => {
    if (popupContent && !popupRef.current && markerRef.current && popupContainerRef.current) {
      const popup = new maplibregl.Popup({
        offset: 25,
        maxWidth: '320px',
        closeButton: true,
        closeOnClick: false,
        className: 'aero-maplibre-popup'
      }).setDOMContent(popupContainerRef.current);
      markerRef.current.setPopup(popup);
      popupRef.current = popup;
    } else if (!popupContent && popupRef.current && markerRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
  }, [Boolean(popupContent)]);

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

  if (!popupContent || !popupContainerRef.current) {
    return null;
  }

  return createPortal(popupContent, popupContainerRef.current);
});

// Backwards compatibility alias
export const GoogleMapMarker = TomTomMapMarker;
