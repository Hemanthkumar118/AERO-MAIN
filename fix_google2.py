import sys
import re

with open('src/services/hospitalSearch/googleProvider.ts', 'r', encoding='utf-8') as f:
    text = f.read()

old_block_pattern = re.compile(r'if \(window\.google\?\.maps\?\.places\?\.Place\?\.searchByText\) \{.*?return results;\s*\}', re.DOTALL)

new_block = """if (window.google?.maps) {
      console.log(`[GoogleProvider] Querying Google Places API (New) JS TEXT SEARCH for: ${query}`);
      const { Place } = await window.google.maps.importLibrary("places") as any;
      
      if (!Place) {
         throw new Error("Google Maps Places library failed to load");
      }
      
      const request = {
          textQuery: query.trim(),
          fields: [
              "displayName",
              "location",
              "formattedAddress",
              "primaryType",
              "types",
              "businessStatus",
              "googleMapsURI"
          ],
          includedType: "hospital",
          useStrictTypeFiltering: true,
          locationBias: {
              center: { lat, lng },
              radius: Math.min(radiusMeters, 50000)
          },
          language: "en",
          maxResultCount: 20,
          region: "IN"
      };

      try {
        const response = await Place.searchByText(request);
        const places = Array.isArray(response?.places) ? response.places : [];
        
        for (const place of places) {
          if (!place) continue;

          // strict hospital check
          const primary = (place.primaryType || '').toLowerCase();
          const types = Array.isArray(place.types) ? place.types.map(t => String(t).toLowerCase()) : [];
          
          if (primary !== 'hospital' && !types.includes('hospital')) continue;

          const nameRaw = typeof place.displayName === 'string' ? place.displayName : place.displayName?.text;
          if (!nameRaw) continue;
          const nameStr = String(nameRaw);

          const nameLower = nameStr.toLowerCase();
          const isClinicOrShop = 
            nameLower.includes('clinic') || nameLower.includes('pharmacy') || nameLower.includes('medical shop') || 
            nameLower.includes('dental') || nameLower.includes('diagnostic') || nameLower.includes('optical') ||
            nameLower.includes('dispensary') || nameLower.includes('dr.') || nameLower.includes('dr ') ||
            nameLower.includes('first aid') || nameLower.includes('health center') || nameLower.includes('physiotherapy') ||
            nameLower.includes('veterinary') || nameLower.includes('blood bank') || nameLower.includes('nursing home') ||
            nameLower.includes('wellness') || nameLower.includes('complex') || nameLower.includes('hsptl') ||
            nameLower.includes('store') || nameLower.includes('medicals') || nameLower.includes('scan') ||
            nameLower.includes('imaging') || nameLower.includes('x-ray') || nameLower.includes('xray') ||
            nameLower.includes('lab') || nameLower.includes('mri') || nameLower.includes('rehab') ||
            nameLower.includes('therapy') || nameLower.includes('ayurvedic') || nameLower.includes('homeopathic') ||
            nameLower.includes('unani') || nameLower.includes('skin') || nameLower.includes('hair') ||
            nameLower.includes('fertility') || nameLower.includes('maternity') || nameLower.includes('eye') ||
            nameLower.includes('vision') || nameLower.includes('optics') || nameLower.includes('opticals');

          if (
            isClinicOrShop ||
            types.includes('pharmacy') || types.includes('dentist') || types.includes('medical_clinic') || 
            types.includes('doctor') || types.includes('veterinary_care') || types.includes('physiotherapist') || 
            types.includes('store') || types.includes('shopping_mall') || types.includes('locality') ||
            types.includes('sublocality') || types.includes('drugstore')
          ) {
             continue;
          }

          const id = place.id;
          if (!id || seenIds.has(id)) continue;

          let pLat = 0;
          let pLng = 0;
          if (place.location) {
             pLat = typeof place.location.lat === 'function' ? place.location.lat() : (place.location.lat ?? place.location.latitude ?? 0);
             pLng = typeof place.location.lng === 'function' ? place.location.lng() : (place.location.lng ?? place.location.longitude ?? 0);
          }
          if (!pLat || !pLng || !Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;

          seenIds.add(id);
          results.push({
            providerId: id,
            provider: 'google',
            name: nameStr.trim(),
            lat: pLat,
            lng: pLng,
            address: place.formattedAddress || '',
            phone: place.nationalPhoneNumber || '',
            googleMapsUri: place.googleMapsURI ?? null,
            businessStatus: place.businessStatus ?? null,
            types: primary ? [primary] : types
          });
        }
        
        return results;
      } catch (error: any) {
         console.error("[Hospital Text Search] FAILED", {
            message: error?.message,
            name: error?.name,
            code: error?.code,
            status: error?.status,
            details: error
         });
         throw error;
      }
    }"""

text = old_block_pattern.sub(new_block, text)

with open('src/services/hospitalSearch/googleProvider.ts', 'w', encoding='utf-8') as f:
    f.write(text)
print('Updated googleProvider.ts')
