import { createContext, useContext } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { TomTomMap } from '@tomtom-org/maps-sdk/map';

export interface TomTomMapContextValue {
  map: MapLibreMap | null;
  tomtomMap: TomTomMap | null;
}

export type GoogleMapContextType = TomTomMapContextValue;

export const TomTomMapContext = createContext<TomTomMapContextValue>({
  map: null,
  tomtomMap: null,
});

export function useTomTomMap(): TomTomMapContextValue {
  return useContext(TomTomMapContext);
}

// Backwards compatibility alias
export const useGoogleMap = () => {
  const ctx = useTomTomMap();
  return { map: ctx.map as any };
};

export const GoogleMapContext = TomTomMapContext;
