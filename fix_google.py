import sys

with open('src/services/hospitalSearch/googleProvider.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if 'const { places } = await Place.searchByText(request);' in line:
        start_idx = i
    if start_idx != -1 and 'return results;' in line:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    new_lines = lines[:start_idx]
    
    new_content = """      const response = await Place.searchByText(request);
      const places = response?.places ?? [];
      
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

        let lat = 0;
        let lng = 0;
        if (place.location) {
           lat = typeof place.location.lat === 'function' ? place.location.lat() : (place.location.lat ?? place.location.latitude ?? 0);
           lng = typeof place.location.lng === 'function' ? place.location.lng() : (place.location.lng ?? place.location.longitude ?? 0);
        }
        if (!lat || !lng || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        seenIds.add(id);
        results.push({
          providerId: id,
          provider: 'google',
          name: nameStr.trim(),
          lat: lat,
          lng: lng,
          address: place.formattedAddress || '',
          phone: place.nationalPhoneNumber || '',
          googleMapsUri: place.googleMapsURI ?? null,
          businessStatus: place.businessStatus ?? null,
          types: primary ? [primary] : types
        });
      }
      
"""
    new_lines.append(new_content)
    new_lines.extend(lines[end_idx:])
    
    with open('src/services/hospitalSearch/googleProvider.ts', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print('Done editing googleProvider')
else:
    print('Could not find start/end')
