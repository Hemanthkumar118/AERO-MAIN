import { createContext, useContext } from 'react';

export interface GoogleMapContextType {
  map: google.maps.Map | null;
}

export const GoogleMapContext = createContext<GoogleMapContextType | null>(null);

export function useGoogleMap() {
  const context = useContext(GoogleMapContext);
  if (!context) {
    throw new Error('useGoogleMap must be used within a GoogleMapContext.Provider');
  }
  return context;
}

// Legacy alias for backward compatibility during migration
export const MapplsContext = GoogleMapContext;
export type MapplsContextType = GoogleMapContextType;
export const useMappls = useGoogleMap;
