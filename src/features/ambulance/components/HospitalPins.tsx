import { memo, useMemo } from 'react';
import type { NormalizedHospital } from '../../../services/hospitalSearch/types';
import { MapplsMarker } from '../../../components/map/MapplsMarker';
import { useMappls } from '../../../components/map/MapplsContext';

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

/* ── Single hospital pin (memoized) ── */
const HospitalPin = memo(function HospitalPin({
  hospital,
  onSelect,
}: {
  hospital: NormalizedHospital;
  onSelect: (h: NormalizedHospital) => void;
}) {
  const { map } = useMappls();
  const distKm = ((hospital as any).drivingDistanceMeters
    ? (hospital as any).drivingDistanceMeters
    : hospital.distanceMeters) / 1000;

  const handleClick = () => {
    onSelect(hospital);
    if (map) {
      map.setCenter({ lat: hospital.lat, lng: hospital.lng });
      map.setZoom(15);
    }
  };

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
          onClick={handleClick}
          className="text-xs bg-emerald-600 text-white font-bold px-3 py-1 rounded-lg hover:bg-emerald-500 cursor-pointer"
        >
          Route
        </button>
      </div>
    </div>
  );

  return (
    <MapplsMarker
      position={[hospital.lat, hospital.lng]}
      html={BLUE_ICON_HTML}
      width={28}
      height={36}
      offset={[14, 36]}
      onClick={handleClick}
      popupContent={popupContent}
    />
  );
});

/* ── Main component (memoized) ── */
export const HospitalPins = memo(function HospitalPins({
  hospitals,
  selectedHospitalId,
  onSelect,
}: HospitalPinsProps) {
  // Filter out the selected hospital (AmbulanceDashboard renders its own HospitalMarker for it)
  const visibleHospitals = useMemo(
    () => hospitals.filter(h => h.id !== selectedHospitalId),
    [hospitals, selectedHospitalId],
  );

  return (
    <>
      {visibleHospitals.map(h => (
        <HospitalPin key={h.id} hospital={h} onSelect={onSelect} />
      ))}
    </>
  );
});
