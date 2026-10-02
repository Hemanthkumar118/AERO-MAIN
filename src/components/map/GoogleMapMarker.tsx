import { useEffect, useRef } from 'react';
import { renderToString } from 'react-dom/server';
import { useGoogleMap } from './GoogleMapContext';

interface GoogleMapMarkerProps {
  position: [number, number];
  html?: string;
  popupContent?: React.ReactNode;
  width?: number;
  height?: number;
  offset?: [number, number];
  onClick?: () => void;
}

export function GoogleMapMarker({ position, html, popupContent, width, height, onClick }: GoogleMapMarkerProps) {
  const { map } = useGoogleMap();
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const popupHtmlDep = popupContent ? renderToString(<div className="aero-custom-popup">{popupContent}</div>) : '';

  useEffect(() => {
    if (!map) return;

    try {
      // Create the marker content element
      const contentEl = document.createElement('div');
      if (html) {
        contentEl.innerHTML = html;
      }
      if (width) contentEl.style.width = `${width}px`;
      if (height) contentEl.style.height = `${height}px`;
      contentEl.style.cursor = 'pointer';

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: position[0], lng: position[1] },
        content: contentEl,
      });

      markerRef.current = marker;

      // Info window for popup
      if (popupHtmlDep) {
        const infoWindow = new google.maps.InfoWindow({
          content: popupHtmlDep,
          maxWidth: 300,
        });
        infoWindowRef.current = infoWindow;

        marker.addListener('click', () => {
          infoWindow.open({ anchor: marker, map });
          if (onClick) onClick();
        });
      } else if (onClick) {
        marker.addListener('click', onClick);
      }
    } catch (err) {
      console.error('[GoogleMapMarker] Error creating marker:', err);
    }

    return () => {
      try {
        if (infoWindowRef.current) {
          infoWindowRef.current.close();
          infoWindowRef.current = null;
        }
        if (markerRef.current) {
          markerRef.current.map = null;
          markerRef.current = null;
        }
      } catch (err) {
        console.error('[GoogleMapMarker] Error removing marker:', err);
      }
    };
  }, [map, html, popupHtmlDep, width, height]);

  // Update marker position smoothly
  useEffect(() => {
    try {
      if (markerRef.current) {
        markerRef.current.position = { lat: position[0], lng: position[1] };
      }
    } catch (e) {
      console.error('[GoogleMapMarker] Error setting position:', e);
    }
  }, [position[0], position[1]]);

  return null;
}

// Legacy alias
export const MapplsMarker = GoogleMapMarker;
