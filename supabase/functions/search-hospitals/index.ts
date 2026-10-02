import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!GOOGLE_MAPS_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'GOOGLE_MAPS_API_KEY not configured' }),
        { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { action, latitude, longitude, radius, query, type, placeId } = await req.json();

    if (!latitude || !longitude) {
       return new Response(JSON.stringify({ error: 'Missing coordinates' }), {
         status: 400,
         headers: { ...corsHeaders, 'Content-Type': 'application/json' },
       });
    }

    // Prepare Google Places API New request
    let url = '';
    let body = {};
    
    if (action === 'autocomplete') {
      url = 'https://places.googleapis.com/v1/places:autocomplete';
      body = {
        input: query,
        locationBias: {
          circle: {
            center: { latitude, longitude },
            radius: radius || 50000.0
          }
        }
      };
    } else if (action === 'details') {
      url = `https://places.googleapis.com/v1/places/${placeId}`;
      body = {}; // GET request actually, but fetch below uses POST. We need to handle this.
    } else if (query) {
      // Text Search
      url = 'https://places.googleapis.com/v1/places:searchText';
      body = {
        textQuery: query,
        locationBias: {
          circle: {
            center: { latitude, longitude },
            radius: radius || 50000.0
          }
        },
        maxResultCount: 20
      };
    } else {
      // Nearby Search
      url = 'https://places.googleapis.com/v1/places:searchNearby';
      body = {
        includedTypes: [type || 'hospital'],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: { latitude, longitude },
            radius: radius || 50000.0
          }
        },
        rankPreference: 'DISTANCE'
      };
    }

    const fetchOptions: RequestInit = {
      method: action === 'details' ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      }
    };

    if (action === 'autocomplete') {
      // no field mask required for autocomplete, or we can leave it blank
    } else {
      (fetchOptions.headers as any)['X-Goog-FieldMask'] = 'places.id,places.displayName,places.location,places.formattedAddress,places.primaryType,places.nationalPhoneNumber,places.googleMapsUri,places.businessStatus';
      if (action === 'details') {
        (fetchOptions.headers as any)['X-Goog-FieldMask'] = 'id,displayName,location,formattedAddress,primaryType,nationalPhoneNumber,googleMapsUri,businessStatus';
      }
    }

    if (action !== 'details') {
      fetchOptions.body = JSON.stringify(body);
    }

    const res = await fetch(url, fetchOptions);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Google Places API Error:', res.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Google API error', details: errorText }),
        { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await res.json();
    
    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Edge Function Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
