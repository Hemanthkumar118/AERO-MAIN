import { createContext, useContext, useState, type ReactNode } from 'react';

interface MapContextType {
  trafficEnabled: boolean;
  setTrafficEnabled: (enabled: boolean) => void;
  mapStyle: 'navigation-night' | 'streets' | 'satellite';
  setMapStyle: (style: 'navigation-night' | 'streets' | 'satellite') => void;
}

const MapContext = createContext<MapContextType | undefined>(undefined);

export function MapProvider({ children }: { children: ReactNode }) {
  const [trafficEnabled, setTrafficEnabled] = useState(false);
  const [mapStyle, setMapStyle] = useState<'navigation-night' | 'streets' | 'satellite'>('navigation-night');

  return (
    <MapContext.Provider value={{ trafficEnabled, setTrafficEnabled, mapStyle, setMapStyle }}>
      {children}
    </MapContext.Provider>
  );
}

export function useMapConfig() {
  const context = useContext(MapContext);
  if (context === undefined) {
    throw new Error('useMapConfig must be used within a MapProvider');
  }
  return context;
}
