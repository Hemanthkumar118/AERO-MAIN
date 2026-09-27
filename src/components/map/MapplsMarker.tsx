import { useEffect, useRef } from 'react';
import { renderToString } from 'react-dom/server';
import { useMappls } from './MapplsContext';

interface MapplsMarkerProps {
  position: [number, number];
  html?: string;
  popupContent?: React.ReactNode;
  width?: number;
  height?: number;
  offset?: [number, number];
  onClick?: () => void;
}

export function MapplsMarker({ position, html, popupContent, width, height, offset, onClick }: MapplsMarkerProps) {
  const { map, mapplsClassObject } = useMappls();
  const markerRef = useRef<any>(null);

  const popupHtmlDep = popupContent ? renderToString(<div className="aero-custom-popup">{popupContent}</div>) : '';

  useEffect(() => {
    if (!map || !mapplsClassObject) return;

    const marker = new (mapplsClassObject as any).Marker({
      map: map,
      position: { lat: position[0], lng: position[1] },
      html: html,
      popupHtml: popupHtmlDep || undefined,
      width: width,
      height: height,
      offset: offset,
    });

    markerRef.current = marker;

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, [map, mapplsClassObject, position[0], position[1], html, popupHtmlDep, width, height, offset?.[0], offset?.[1]]);

  // Handle onClick separately so we don't recreate the marker
  useEffect(() => {
    if (markerRef.current && onClick) {
      markerRef.current.addListener('click', onClick);
      return () => {
        markerRef.current.removeListener('click', onClick);
      };
    }
  }, [onClick]);

  return null;
}
