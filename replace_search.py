import sys
with open('src/features/ambulance/components/HospitalSearchPanel.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace import
content = content.replace(
    '''import { autocompleteGooglePlaces, getGooglePlaceDetails } from '../../../services/hospitalSearch';''',
    '''import { searchHospitalsByText } from '../../../services/hospitalSearch';'''
)

# Replace the states and useEffect for text search
target_states = '''  const [autocompleteResults, setAutocompleteResults] = useState<any[]>([]);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  const [fetchingDetailsId, setFetchingDetailsId] = useState<string | null>(null);

  // Debounce autocomplete search
  useEffect(() => {
    if (!localSearch.trim()) {
      setAutocompleteResults([]);
      return;
    }

    const handler = setTimeout(async () => {
      setAutocompleteLoading(true);
      try {
        const results = await autocompleteGooglePlaces(localSearch, centerLocation[0], centerLocation[1], 50000);
        setAutocompleteResults(results);
      } catch (err) {
        console.error("Autocomplete failed:", err);
        setAutocompleteResults([]);
      } finally {
        setAutocompleteLoading(false);
      }
    }, 400);

    return () => clearTimeout(handler);
  }, [localSearch, centerLocation]);

  const handleSelectNearby = (h: NormalizedHospital) => {
    onSelect(h);
    setOpen(false);
  };

  const handleSelectAutocomplete = async (placeId: string) => {
    setFetchingDetailsId(placeId);
    try {
      const details = await getGooglePlaceDetails(placeId);
      if (!details) throw new Error("Place details not found");
      
      // Calculate a rough distance using the haversine formula
      const R = 6371e3; // metres
      const lat1 = centerLocation[0];
      const lon1 = centerLocation[1];
      const lat2 = details.lat;
      const lon2 = details.lng;
      const φ1 = lat1 * Math.PI/180;
      const φ2 = lat2 * Math.PI/180;
      const Δφ = (lat2-lat1) * Math.PI/180;
      const Δλ = (lon2-lon1) * Math.PI/180;

      const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distanceMeters = R * c;

      if (distanceMeters > radiusKm * 1000) {
        alert("Hospital is outside the selected search radius.");
        return;
      }
      
      const primary = (details as any).primaryType || "";
      const types = details.types || [];
      const name = (details.name || "").toLowerCase();
      
      if (primary !== "hospital" && !types.includes("hospital")) {
         alert("Selected place is not classified as a hospital.");
         return;
      }
      
      const isClinicOrShop = 
          name.includes("clinic") || name.includes("pharmacy") || name.includes("medical shop") || 
          name.includes("dental") || name.includes("diagnostic") || name.includes("optical") ||
          name.includes("dispensary") || name.includes("dr.") || name.includes("dr ") ||
          name.includes("first aid") || name.includes("health center") || name.includes("physiotherapy") ||
          name.includes("veterinary") || name.includes("blood bank") || name.includes("nursing home") ||
          name.includes("wellness") || name.includes("complex") || name.includes("hsptl") ||
          name.includes("store") || name.includes("medicals") || name.includes("scan") ||
          name.includes("imaging") || name.includes("x-ray") || name.includes("xray") ||
          name.includes("lab") || name.includes("mri") || name.includes("rehab") ||
          name.includes("therapy") || name.includes("ayurvedic") || name.includes("homeopathic") ||
          name.includes("unani") || name.includes("skin") || name.includes("hair") ||
          name.includes("fertility") || name.includes("maternity") || name.includes("eye") ||
          name.includes("vision") || name.includes("optics") || name.includes("opticals") ||
          name === "tandur" || name === "esi dispensary";
          
      if (
          isClinicOrShop ||
          types.includes("pharmacy") || types.includes("dentist") || types.includes("medical_clinic") || 
          types.includes("doctor") || types.includes("veterinary_care") || types.includes("physiotherapist") || 
          types.includes("store") || types.includes("shopping_mall") || types.includes("locality") ||
          types.includes("sublocality") || types.includes("sublocality_level_1") || types.includes("neighborhood") ||
          types.includes("drugstore")
      ) {
         alert("Selected place is not classified as a hospital.");
         return;
      }

      if (!details) throw new Error("Place details not found");
      const normalized: NormalizedHospital = {
        id: details.providerId,
        providerId: details.providerId,
        provider: details.provider,
        name: details.name,
        lat: details.lat,
        lng: details.lng,
        address: details.address,
        phone: details.phone,
        types: details.types,
        distanceMeters,
      };

      onSelect(normalized);
      setOpen(false);
    } catch (err) {
      console.error("Failed to get place details:", err);
      alert("Failed to load hospital details. Please try again.");
    } finally {
      setFetchingDetailsId(null);
    }
  };'''

replacement_states = '''  const [textSearchResults, setTextSearchResults] = useState<NormalizedHospital[]>([]);
  const [textSearchLoading, setTextSearchLoading] = useState(false);
  const [textSearchError, setTextSearchError] = useState<string | null>(null);

  // Debounce text search
  useEffect(() => {
    if (!localSearch.trim() || localSearch.trim().length < 2) {
      setTextSearchResults([]);
      setTextSearchError(null);
      return;
    }

    const abortController = new AbortController();
    const handler = setTimeout(async () => {
      setTextSearchLoading(true);
      setTextSearchError(null);
      try {
        const { results } = await searchHospitalsByText(
          localSearch, 
          centerLocation[0], 
          centerLocation[1], 
          radiusKm * 1000, 
          abortController.signal
        );
        setTextSearchResults(results);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error("Text Search failed:", err);
          setTextSearchError("HOSPITAL SEARCH TEMPORARILY UNAVAILABLE");
          setTextSearchResults([]);
        }
      } finally {
        setTextSearchLoading(false);
      }
    }, 400);

    return () => {
      clearTimeout(handler);
      abortController.abort();
    };
  }, [localSearch, centerLocation, radiusKm]);

  const handleSelectNearby = (h: NormalizedHospital) => {
    onSelect(h);
    setOpen(false);
  };'''

content = content.replace(target_states, replacement_states)

# Replace the search bar loading state check
content = content.replace(
    '''{loading || autocompleteLoading || fetchingDetailsId ? (''',
    '''{loading || textSearchLoading ? ('''
)

# Replace the text search UI
target_ui = '''            {localSearch.trim() && (
              <div className="px-3 py-2 border-b border-border-subtle flex flex-col gap-2 bg-bg-elevated shrink-0">
                <div className="flex items-center justify-between">
                  <span className="telemetry-label text-[10px] font-bold uppercase">
                    {autocompleteLoading ? 'SEARCHING GOOGLE PLACES...' : 'GOOGLE PLACES RESULTS'}
                  </span>
                  <span className="text-[10px] text-[#35C7FF] font-medium">🔍 Search</span>
                </div>
              </div>
            )}

            {/* List with correct scroll containment */}
            <div 
              className="overflow-y-auto flex-1 overscroll-contain"
              style={{ minHeight: 0 }}
            >
              {localSearch.trim() ? (
                /* Autocomplete Results */
                <div className="flex flex-col">
                  {autocompleteResults.length === 0 && !autocompleteLoading && (
                    <div className="p-4 text-center text-xs text-text-secondary font-medium uppercase">
                      NO RESULTS FOUND
                    </div>
                  )}
                  {autocompleteResults.map((pred, i) => (
                    <button
                      key={pred.placeId || i}
                      onClick={() => handleSelectAutocomplete(pred.placeId)}
                      disabled={fetchingDetailsId === pred.placeId}
                      className="flex flex-col text-left px-3 py-3 hover:bg-bg-elevated border-b border-border-subtle/50 transition-colors cursor-pointer group disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white group-hover:text-[#35C7FF] transition-colors">{pred.primaryText}</span>
                        {fetchingDetailsId === pred.placeId && (
                           <span className="text-[10px] text-[#35C7FF] animate-pulse">Loading...</span>
                        )}
                      </div>
                      {pred.secondaryText && (
                        <div className="text-xs text-text-secondary line-clamp-1 mt-0.5">{pred.secondaryText}</div>
                      )}
                    </button>
                  ))}
                </div>
              ) : ('''

replacement_ui = '''            {localSearch.trim().length >= 2 && (
              <div className="px-3 py-2 border-b border-border-subtle flex flex-col gap-2 bg-bg-elevated shrink-0">
                <div className="flex items-center justify-between">
                  <span className="telemetry-label text-[10px] font-bold uppercase">
                    {textSearchLoading ? 'SEARCHING GOOGLE PLACES...' : 
                     textSearchError ? textSearchError :
                     textSearchResults.length > 0 ? 'GOOGLE PLACES RESULTS' : 'NO HOSPITALS FOUND'}
                  </span>
                  <span className="text-[10px] text-[#35C7FF] font-medium">🔍 Search</span>
                </div>
              </div>
            )}

            {/* List with correct scroll containment */}
            <div 
              className="overflow-y-auto flex-1 overscroll-contain"
              style={{ minHeight: 0 }}
            >
              {localSearch.trim().length >= 2 ? (
                /* Text Search Results */
                <div className="flex flex-col">
                  {textSearchError && (
                    <div className="p-4 text-center text-xs text-red-400 font-medium uppercase">
                      {textSearchError}
                    </div>
                  )}
                  {textSearchResults.length === 0 && !textSearchLoading && !textSearchError && (
                    <div className="p-4 text-center text-xs text-text-secondary font-medium uppercase">
                      NO HOSPITALS FOUND
                    </div>
                  )}
                  {textSearchResults.map((h, i) => (
                    <button
                      key={h.id}
                      onClick={() => handleSelectNearby(h)}
                      className={`flex flex-col text-left px-3 py-3 hover:bg-bg-elevated border-b border-border-subtle/50 transition-colors cursor-pointer group ${selectedHospitalId === h.id ? 'bg-[#35C7FF]/10' : ''}`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white group-hover:text-[#35C7FF] transition-colors">{h.name}</span>
                          </div>
                          <div className="text-xs text-text-secondary line-clamp-1 mt-0.5">{h.address}</div>
                        </div>
                        <div className="text-right shrink-0 flex flex-col items-end">
                          <span className="text-[10px] font-bold text-[#35C7FF] bg-[#35C7FF]/10 px-1.5 py-0.5 rounded">
                            {(h.distanceMeters / 1000).toFixed(1)} km
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : ('''

content = content.replace(target_ui, replacement_ui)

with open('src/features/ambulance/components/HospitalSearchPanel.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done2')
