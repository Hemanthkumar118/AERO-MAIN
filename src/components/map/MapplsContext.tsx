import { createContext, useContext } from 'react';

export interface MapplsContextType {
  map: any;
  mapplsClassObject: any;
}

export const MapplsContext = createContext<MapplsContextType | null>(null);

export function useMappls() {
  const context = useContext(MapplsContext);
  if (!context) {
    throw new Error('useMappls must be used within a MapplsContext.Provider');
  }
  return context;
}
