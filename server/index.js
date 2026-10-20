import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';
import crypto from 'crypto';

dotenv.config();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const PORT = process.env.PORT || 3001;

const isSupabaseConfigured = Boolean(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const isGroqConfigured = Boolean(process.env.GROQ_API_KEY);
const groqModel = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const isTomTomConfigured = Boolean(process.env.TOMTOM_API_KEY || process.env.VITE_TOMTOM_API_KEY);

console.log('--- AERO Backend Diagnostics ---');
console.log(`Supabase URL configured: ${process.env.VITE_SUPABASE_URL ? 'YES' : 'NO'}`);
console.log(`Supabase key configured: ${process.env.VITE_SUPABASE_PUBLISHABLE_KEY ? 'YES' : 'NO'}`);
console.log(`Groq key configured: ${isGroqConfigured ? 'YES' : 'NO'}`);
console.log(`Groq model: ${groqModel}`);
console.log(`TomTom Traffic & Routing API configured: ${isTomTomConfigured ? 'YES' : 'NO'}`);
console.log('--------------------------------');

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'AERO AI Backend',
    providers: {
      supabase: isSupabaseConfigured,
      groq: isGroqConfigured,
      tomtom: isTomTomConfigured,
      google: Boolean(process.env.GOOGLE_MAPS_API_KEY),
      ors: Boolean(process.env.OPENROUTESERVICE_API_KEY),
      osrm: true
    },
    timestamp: new Date().toISOString()
  });
});

// Initialize Supabase admin client for auth verification only if configured
const supabase = isSupabaseConfigured 
  ? createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  : null;

// Initialize Groq SDK only if configured
const groq = process.env.GROQ_API_KEY 
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;

// Middleware to authenticate requests using Supabase JWT
const authenticateUser = async (req, res, next) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Backend authentication is not configured.' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header provided.' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  req.user = user;
  next();
};

// Optional auth middleware: extracts user if provided, but does not block requests
const authenticateOptionalUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && supabase) {
    const token = authHeader.replace('Bearer ', '');
    try {
      const { data: { user } } = await supabase.auth.getUser(token);
      req.user = user || null;
    } catch {
      req.user = null;
    }
  }
  next();
};

const SYSTEM_PROMPT = `You are AERO Assistant, an AI assistant integrated into an emergency response coordination platform.

Your purpose is to assist emergency-response operators with information organization, incident summaries, routing-related reasoning, operational checklists, and coordination support.

You are NOT a replacement for emergency dispatchers, medical professionals, police, firefighters, or trained emergency personnel.

Never claim that you contacted emergency services, hospitals, police, ambulances, or traffic authorities unless the application actually performed that action.

Never fabricate GPS coordinates, traffic conditions, hospital capacity, ETAs, routes, or emergency incidents.

If required operational data is unavailable, explicitly say that the data is unavailable.

For medical questions, provide general informational guidance only and clearly recommend following trained emergency medical protocols and contacting appropriate emergency services when necessary.

Keep responses concise during active incidents.

Prioritize:
1. Safety
2. Accuracy
3. Clarity
4. Coordination
5. Actionable information

When given an incident, structure the response where useful as:
Situation
Priority
Known Information
Recommended Coordination
Missing Information
Next Step

Always distinguish between actual application data and assumptions.`;

// Chatbot API Endpoint
app.post('/api/ai/chat', authenticateUser, async (req, res) => {
  try {
    const { message, conversationId, incidentContext } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'A valid message string is required.' });
    }

    if (!groq) {
      return res.status(503).json({ error: 'AI Assistant is currently unavailable due to missing GROQ configuration.' });
    }

    // Initialize authenticated Supabase client for DB operations (RLS enforced)
    const token = req.headers.authorization.replace('Bearer ', '');
    const userSupabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    let currentConvId = conversationId;

    // 1. Initialize Conversation if missing
    if (!currentConvId) {
      currentConvId = crypto.randomUUID();
      const { error: convError } = await userSupabase
        .from('ai_conversations')
        .insert({
          id: currentConvId,
          title: `Chat ${new Date().toLocaleTimeString()}`,
          user_id: req.user.id
        });

      if (convError) {
        console.error('Failed to create conversation:', convError);
        return res.status(500).json({ error: 'Failed to initialize conversation in database.' });
      }
    }

    // 2. Save User Message
    const userMessageId = crypto.randomUUID();
    const { error: userMsgError } = await userSupabase
      .from('ai_messages')
      .insert({
        id: userMessageId,
        conversation_id: currentConvId,
        user_id: req.user.id,
        role: 'user',
        content: message
      });

    if (userMsgError) {
      console.error('Failed to save user message:', userMsgError);
      return res.status(500).json({ error: 'Failed to save your message.' });
    }

    // 3. Load Conversation History
    const { data: history, error: historyError } = await userSupabase
      .from('ai_messages')
      .select('role, content')
      .eq('conversation_id', currentConvId)
      .order('created_at', { ascending: true });

    if (historyError) {
      console.error('Failed to load history:', historyError);
      return res.status(500).json({ error: 'Failed to load conversation history.' });
    }

    // 4. Build System Prompt & Messages for Groq
    let currentSystemPrompt = SYSTEM_PROMPT;
    if (incidentContext) {
      currentSystemPrompt += `\n\n--- ACTIVE INCIDENT CONTEXT ---\n${incidentContext}`;
    }

    const chatMessages = [
      { role: 'system', content: currentSystemPrompt },
      ...history.map(h => ({ role: h.role, content: h.content }))
    ];

    // 5. Call Groq
    const chatCompletion = await groq.chat.completions.create({
      messages: chatMessages,
      model: groqModel,
      temperature: 0.2,
      max_tokens: 1024,
    });

    const reply = chatCompletion.choices[0]?.message?.content || '';

    // 6. Save Assistant Message
    const { error: asstMsgError } = await userSupabase
      .from('ai_messages')
      .insert({
        id: crypto.randomUUID(),
        conversation_id: currentConvId,
        user_id: req.user.id,
        role: 'assistant',
        content: reply
      });

    if (asstMsgError) {
      console.error('Failed to save assistant message:', asstMsgError);
      // We still return the reply to the user, even if history persistence fails
    }

    // 7. Return Authoritative Response
    res.json({
      success: true,
      conversationId: currentConvId,
      message: {
        role: 'assistant',
        content: reply
      }
    });

  } catch (error) {
    if (error.status === 429) {
      return res.status(429).json({ error: 'AI service is temporarily busy due to rate limits.' });
    }
    console.error('AI Endpoint Error:', error.message || error);
    res.status(500).json({ error: 'AERO AI is temporarily unavailable. Please try again.' });
  }
});

// Google Places API (New) Proxy Endpoint - Nearby Search
app.post('/api/places/nearby', authenticateUser, async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Google Maps API Key is not configured on the server.' });
    }

    const { latitude, longitude, radius = 15000 } = req.body;
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required.' });
    }

    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.businessStatus,places.googleMapsUri,places.rating,places.userRatingCount,places.regularOpeningHours'
      },
      body: JSON.stringify({
        includedTypes: ['hospital', 'general_hospital'],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: { latitude, longitude },
            radius: radius
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google Places Nearby Error:', errorText);
      return res.status(response.status).json({ error: 'Failed to fetch nearby hospitals.' });
    }

    const data = await response.json();
    res.json({ results: data.places || [] });
  } catch (error) {
    console.error('Places Nearby Endpoint Error:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch places data.' });
  }
});

// Google Places API (New) Proxy Endpoint - Text Search (supports pagination)
app.post('/api/places/textsearch', authenticateUser, async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Google Maps API Key is not configured on the server.' });
    }

    const { latitude, longitude, radius = 15000, query, pageToken } = req.body;
    if (!latitude || !longitude || !query) {
      return res.status(400).json({ error: 'Latitude, longitude, and query are required.' });
    }

    const requestBody = {
      textQuery: query,
      pageSize: 20,
      locationBias: {
        circle: {
          center: { latitude, longitude },
          radius: radius
        }
      }
    };
    
    if (pageToken) {
      requestBody.pageToken = pageToken;
    }

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.businessStatus,places.googleMapsUri,places.rating,places.userRatingCount,places.regularOpeningHours,nextPageToken'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google Places Text Search Error:', errorText);
      return res.status(response.status).json({ error: 'Failed to fetch text search hospitals.' });
    }

    const data = await response.json();
    res.json({ 
      results: data.places || [],
      next_page_token: data.nextPageToken 
    });
  } catch (error) {
    console.error('Places Text Search Endpoint Error:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch places data.' });
  }
});
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchTomTomIncidentsFromBbox(bbox, apiKey) {
  if (!apiKey || !bbox) return [];
  try {
    const fields = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay}}}';
    const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=${bbox}&fields=${encodeURIComponent(fields)}&language=en-GB&key=${apiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return [];

    const data = await response.json();
    const rawIncidents = data.incidents || [];

    const categoryNames = {
      0: 'Unknown Incident',
      1: 'Accident',
      2: 'Fog Hazard',
      3: 'Dangerous Conditions',
      4: 'Heavy Rain',
      5: 'Ice Hazard',
      6: 'Traffic Jam',
      7: 'Lane Closed',
      8: 'Road Closed',
      9: 'Road Works',
      10: 'Wind Hazard',
      11: 'Flooding',
      14: 'Broken Down Vehicle'
    };

    const severityNames = {
      0: 'unknown',
      1: 'minor',
      2: 'moderate',
      3: 'major',
      4: 'blocking'
    };

    return rawIncidents.map(item => {
      const p = item.properties || {};
      const geom = item.geometry || {};
      const coords = geom.coordinates || [];

      let location = { latitude: 0, longitude: 0 };
      let polyline = [];

      if (geom.type === 'Point' && coords.length >= 2) {
        location = { latitude: coords[1], longitude: coords[0] };
        polyline = [[coords[1], coords[0]]];
      } else if (geom.type === 'LineString' && coords.length > 0) {
        location = { latitude: coords[0][1], longitude: coords[0][0] };
        polyline = coords.map(c => [c[1], c[0]]);
      } else if (geom.type === 'MultiLineString' && coords.length > 0 && coords[0].length > 0) {
        location = { latitude: coords[0][0][1], longitude: coords[0][0][0] };
        polyline = coords[0].map(c => [c[1], c[0]]);
      }

      const category = categoryNames[p.iconCategory] || 'Traffic Incident';
      const severity = severityNames[p.magnitudeOfDelay] || 'moderate';
      const eventDesc = (p.events && p.events[0]?.description) || category;

      return {
        id: p.id || `inc-${Math.random().toString(36).substr(2, 9)}`,
        category,
        iconCategory: p.iconCategory,
        severity,
        description: eventDesc,
        delaySeconds: p.delay || 0,
        delayMinutes: p.delay ? Math.round(p.delay / 60) : 0,
        lengthMeters: p.length ? Math.round(p.length) : 0,
        from: p.from || '',
        to: p.to || '',
        startTime: p.startTime,
        endTime: p.endTime,
        location,
        geometry: polyline
      };
    });
  } catch (err) {
    console.warn('[TomTom Incidents] Error:', err.message);
    return [];
  }
}

// Routes API - TomTom (Traffic-Aware), ORS & OSRM Fallback
app.post('/api/route/calculate', authenticateOptionalUser, async (req, res) => {
  try {
    const { origin, destination, provider } = req.body;
    if (!origin || !origin.lat || !origin.lng || !destination || !destination.lat || !destination.lng) {
      return res.status(400).json({ error: 'Origin and destination coordinates are required.' });
    }

    const calculateTomTom = async () => {
      const apiKey = process.env.TOMTOM_API_KEY || process.env.VITE_TOMTOM_API_KEY;
      if (!apiKey) throw new Error('TomTom API key not configured');

      const url = `https://api.tomtom.com/routing/1/calculateRoute/${origin.lat},${origin.lng}:${destination.lat},${destination.lng}/json?traffic=true&computeTravelTimeFor=all&maxAlternatives=2&sectionType=traffic&routeType=fastest&travelMode=car&departAt=now&key=${apiKey}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`TomTom Routing failed (${response.status}): ${errorText.slice(0, 100)}`);
      }

      const data = await response.json();
      if (!data.routes || data.routes.length === 0) {
        throw new Error('No TomTom route found');
      }

      const primaryRoute = data.routes[0];
      const summary = primaryRoute.summary;
      const distanceMeters = summary.lengthInMeters;
      const durationSeconds = summary.travelTimeInSeconds; // traffic-adjusted
      const staticDurationSeconds = summary.noTrafficTravelTimeInSeconds || durationSeconds;
      const trafficDelaySeconds = summary.trafficDelayInSeconds || 0;

      const points = primaryRoute.legs && primaryRoute.legs[0] && primaryRoute.legs[0].points ? primaryRoute.legs[0].points : [];
      const polyline = points.map(pt => [pt.latitude, pt.longitude]);

      // Format alternatives
      const alternatives = (data.routes || []).map((r, idx) => {
        const pts = r.legs && r.legs[0] && r.legs[0].points ? r.legs[0].points.map(pt => [pt.latitude, pt.longitude]) : [];
        const distM = r.summary.lengthInMeters;
        const durS = r.summary.travelTimeInSeconds;
        const statDurS = r.summary.noTrafficTravelTimeInSeconds || durS;
        const delayS = r.summary.trafficDelayInSeconds || 0;
        return {
          id: `route-${idx}`,
          name: idx === 0 ? 'Fastest Route (Live Traffic)' : `Alternative ${idx}`,
          isPrimary: idx === 0,
          distanceMeters: distM,
          distanceKm: distM ? Number((distM / 1000).toFixed(2)) : null,
          durationSeconds: durS,
          durationMinutes: durS ? Math.round(durS / 60) : null,
          etaSeconds: durS,
          staticDurationSeconds: statDurS,
          trafficDelaySeconds: delayS,
          trafficDelayMinutes: Math.round(delayS / 60),
          polyline: pts,
        };
      });

      // Calculate incidents along route
      let routeIncidents = [];
      let congestionSegments = [];

      if (polyline.length > 0) {
        const lats = polyline.map(p => p[0]);
        const lngs = polyline.map(p => p[1]);
        const minLat = (Math.min(...lats) - 0.008).toFixed(4);
        const maxLat = (Math.max(...lats) + 0.008).toFixed(4);
        const minLng = (Math.min(...lngs) - 0.008).toFixed(4);
        const maxLng = (Math.max(...lngs) + 0.008).toFixed(4);
        const routeBbox = `${minLng},${minLat},${maxLng},${maxLat}`;

        const allIncidents = await fetchTomTomIncidentsFromBbox(routeBbox, apiKey);
        
        // Find incidents on or near the route (within 150m)
        routeIncidents = allIncidents.filter(inc => {
          const incLat = inc.location?.latitude;
          const incLng = inc.location?.longitude;
          if (!incLat || !incLng) return false;
          for (let i = 0; i < polyline.length; i += 2) {
            const dist = haversineMeters(incLat, incLng, polyline[i][0], polyline[i][1]);
            if (dist <= 150) {
              inc.distanceToRouteMeters = Math.round(dist);
              return true;
            }
          }
          return false;
        });

        // Determine traffic level for each point along the polyline
        const pointLevels = polyline.map(([lat, lng], idx) => {
          // Check if close to any route incident
          for (const inc of routeIncidents) {
            const dist = haversineMeters(lat, lng, inc.location.latitude, inc.location.longitude);
            if (dist <= 150) {
              if (inc.severity === 'blocking' || inc.delayMinutes >= 5) return 'red';
              if (inc.severity === 'major' || inc.delayMinutes >= 2) return 'orange';
              if (inc.severity === 'moderate' || inc.delayMinutes > 0) return 'yellow';
            }
          }

          // If there are general traffic delays without discrete incidents, color the congested segment
          if (trafficDelaySeconds > 60 && idx > polyline.length * 0.35 && idx < polyline.length * 0.65) {
            return trafficDelaySeconds > 180 ? 'orange' : 'yellow';
          }

          return 'green';
        });

        // Group points into continuous segments
        let currentSeg = null;
        for (let i = 0; i < polyline.length; i++) {
          const pt = polyline[i];
          const level = pointLevels[i];
          if (!currentSeg || currentSeg.level !== level) {
            if (currentSeg) {
              currentSeg.polyline.push(pt);
              congestionSegments.push(currentSeg);
            }
            currentSeg = {
              polyline: [pt],
              level,
              speedLimitKmH: 50,
              averageSpeedKmH: level === 'green' ? 45 : (level === 'yellow' ? 25 : (level === 'orange' ? 15 : 5))
            };
          } else {
            currentSeg.polyline.push(pt);
          }
        }
        if (currentSeg && currentSeg.polyline.length > 0) {
          congestionSegments.push(currentSeg);
        }
      }

      return {
        success: true,
        provider: "tomtom",
        isTrafficAware: true,
        distanceMeters,
        distanceKm: distanceMeters ? Number((distanceMeters / 1000).toFixed(2)) : null,
        durationSeconds,
        durationMinutes: durationSeconds ? Math.round(durationSeconds / 60) : null,
        staticDurationSeconds,
        trafficDelaySeconds,
        trafficDelayMinutes: Math.round(trafficDelaySeconds / 60),
        trafficStatus: trafficDelaySeconds > 180 ? 'HEAVY' : (trafficDelaySeconds > 60 ? 'MODERATE' : 'LIVE'),
        etaText: durationSeconds ? `${Math.round(durationSeconds / 60)} min` : null,
        distanceText: distanceMeters ? (distanceMeters >= 1000 ? `${(distanceMeters / 1000).toFixed(1)} km` : `${Math.round(distanceMeters)} m`) : null,
        polyline,
        congestionSegments,
        routeIncidents,
        alternatives,
        calculatedAt: new Date().toISOString()
      };
    };

    const calculateOSRM = async () => {
      const baseUrl = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
      const url = `${baseUrl}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error('OSRM request failed');
      const data = await response.json();
      
      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
         throw new Error('No OSRM route found');
      }
      const route = data.routes[0];
      const distanceMeters = route.distance;
      const durationSeconds = route.duration;
      // OSRM geojson is [lng, lat]
      const polyline = route.geometry.coordinates.map(coord => [coord[1], coord[0]]); 
      
      const congestionSegments = polyline.length > 0 ? [{
        polyline,
        level: 'green',
        speedLimitKmH: 50,
        averageSpeedKmH: 40
      }] : [];

      return {
        success: true,
        provider: "osrm",
        isTrafficAware: false,
        trafficStatus: "UNAVAILABLE",
        distanceMeters,
        distanceKm: distanceMeters ? Number((distanceMeters / 1000).toFixed(2)) : null,
        durationSeconds,
        durationMinutes: durationSeconds ? Math.round(durationSeconds / 60) : null,
        staticDurationSeconds: durationSeconds,
        trafficDelaySeconds: 0,
        trafficDelayMinutes: 0,
        etaText: durationSeconds ? `${Math.round(durationSeconds / 60)} min` : null,
        distanceText: distanceMeters ? (distanceMeters >= 1000 ? `${(distanceMeters / 1000).toFixed(1)} km` : `${Math.round(distanceMeters)} m`) : null,
        polyline,
        congestionSegments,
        routeIncidents: [],
        alternatives: [],
        calculatedAt: new Date().toISOString()
      };
    };

    const calculateORS = async () => {
      const apiKey = process.env.OPENROUTESERVICE_API_KEY;
      if (!apiKey) throw new Error('ORS API key not configured');
      
      const url = 'https://api.openrouteservice.org/v2/directions/driving-car';
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          coordinates: [
            [origin.lng, origin.lat],
            [destination.lng, destination.lat]
          ]
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error('ORS request failed');
      const data = await response.json();
      
      if (!data.routes || data.routes.length === 0) throw new Error('No ORS route found');
      
      const route = data.routes[0];
      const summary = route.summary;
      const distanceMeters = summary.distance;
      const durationSeconds = summary.duration;
      const polylineStr = route.geometry; // encoded polyline
      
      return {
        success: true,
        provider: "openrouteservice",
        isTrafficAware: false,
        trafficStatus: "UNAVAILABLE",
        distanceMeters,
        distanceKm: distanceMeters ? Number((distanceMeters / 1000).toFixed(2)) : null,
        durationSeconds,
        durationMinutes: durationSeconds ? Math.round(durationSeconds / 60) : null,
        staticDurationSeconds: durationSeconds,
        trafficDelaySeconds: 0,
        etaText: durationSeconds ? `${Math.round(durationSeconds / 60)} min` : null,
        distanceText: distanceMeters ? (distanceMeters >= 1000 ? `${(distanceMeters / 1000).toFixed(1)} km` : `${Math.round(distanceMeters)} m`) : null,
        polyline: polylineStr,
        calculatedAt: new Date().toISOString()
      };
    };

    let result = null;
    const targetProvider = provider || process.env.VITE_ROUTING_PROVIDER || 'tomtom';

    // 1. Try TomTom if requested or by default if configured
    if (targetProvider === 'tomtom' || (!provider && (process.env.TOMTOM_API_KEY || process.env.VITE_TOMTOM_API_KEY))) {
      try {
        result = await calculateTomTom();
      } catch (err) {
        console.warn('TomTom Routing failed, falling back to secondary provider:', err.message);
      }
    }

    // 2. Try ORS if TomTom failed or ORS requested
    if (!result && (targetProvider === 'ors' || !provider || targetProvider === 'tomtom')) {
      try {
        result = await calculateORS();
      } catch (err) {
        console.warn('ORS Routing failed, falling back to OSRM:', err.message);
      }
    }

    // 3. Fallback to free OSRM
    if (!result) {
      try {
        result = await calculateOSRM();
      } catch (err) {
        console.warn('OSRM Routing fallback failed:', err.message);
      }
    }

    if (!result) {
      return res.status(503).json({
        success: false,
        provider: null,
        error: "ROUTE_UNAVAILABLE",
        message: "All routing providers failed to calculate a driving corridor."
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Route Calculation Endpoint Error:', error.message || error);
    res.status(500).json({ error: 'Failed to calculate route.', success: false });
  }
});

// TomTom Traffic Incidents Endpoint
app.get('/api/traffic/incidents', authenticateOptionalUser, async (req, res) => {
  try {
    const apiKey = process.env.TOMTOM_API_KEY || process.env.VITE_TOMTOM_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        error: 'TomTom API key is not configured on the server.',
        incidents: []
      });
    }

    let { bbox, lat, lng, radiusKm = 15 } = req.query;

    if (!bbox && lat && lng) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);
      const r = parseFloat(radiusKm);
      const latDelta = r / 110.574;
      const lngDelta = r / (111.320 * Math.cos(latitude * Math.PI / 180));
      const minLng = (longitude - lngDelta).toFixed(4);
      const maxLng = (longitude + lngDelta).toFixed(4);
      const minLat = (latitude - latDelta).toFixed(4);
      const maxLat = (latitude + latDelta).toFixed(4);
      bbox = `${minLng},${minLat},${maxLng},${maxLat}`;
    }

    if (!bbox) {
      bbox = '78.2000,17.2500,78.6000,17.6000';
    }

    const fields = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay}}}';
    const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=${bbox}&fields=${encodeURIComponent(fields)}&language=en-GB&key=${apiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('TomTom Incidents API error:', response.status, errorText.slice(0, 100));
      return res.status(response.status).json({
        success: false,
        error: `TomTom Incidents API error: ${response.status}`,
        incidents: []
      });
    }

    const data = await response.json();
    const rawIncidents = data.incidents || [];

    const categoryNames = {
      0: 'Unknown Incident',
      1: 'Accident',
      2: 'Fog Hazard',
      3: 'Dangerous Conditions',
      4: 'Heavy Rain',
      5: 'Ice Hazard',
      6: 'Traffic Jam',
      7: 'Lane Closed',
      8: 'Road Closed',
      9: 'Road Works',
      10: 'Wind Hazard',
      11: 'Flooding',
      14: 'Broken Down Vehicle'
    };

    const severityNames = {
      0: 'unknown',
      1: 'minor',
      2: 'moderate',
      3: 'major',
      4: 'blocking'
    };

    const incidents = rawIncidents.map(item => {
      const p = item.properties || {};
      const geom = item.geometry || {};
      const coords = geom.coordinates || [];

      let location = { latitude: 0, longitude: 0 };
      let polyline = [];

      if (geom.type === 'Point' && coords.length >= 2) {
        location = { latitude: coords[1], longitude: coords[0] };
        polyline = [[coords[1], coords[0]]];
      } else if (geom.type === 'LineString' && coords.length > 0) {
        location = { latitude: coords[0][1], longitude: coords[0][0] };
        polyline = coords.map(c => [c[1], c[0]]);
      } else if (geom.type === 'MultiLineString' && coords.length > 0 && coords[0].length > 0) {
        location = { latitude: coords[0][0][1], longitude: coords[0][0][0] };
        polyline = coords[0].map(c => [c[1], c[0]]);
      }

      const category = categoryNames[p.iconCategory] || 'Traffic Incident';
      const severity = severityNames[p.magnitudeOfDelay] || 'moderate';
      const eventDesc = (p.events && p.events[0]?.description) || category;

      return {
        id: p.id || `inc-${Math.random().toString(36).substr(2, 9)}`,
        category,
        iconCategory: p.iconCategory,
        severity,
        description: eventDesc,
        delaySeconds: p.delay || 0,
        delayMinutes: p.delay ? Math.round(p.delay / 60) : 0,
        lengthMeters: p.length ? Math.round(p.length) : 0,
        from: p.from || '',
        to: p.to || '',
        startTime: p.startTime,
        endTime: p.endTime,
        location,
        geometry: polyline
      };
    });

    res.json({
      success: true,
      count: incidents.length,
      incidents,
      source: 'tomtom',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('TomTom Incidents Endpoint Error:', error.message || error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch traffic incidents.',
      incidents: []
    });
  }
});

// Server-side in-memory cache for hospital searches (5-minute TTL)
const serverHospitalCache = new Map();
const HOSPITAL_CACHE_TTL_MS = 5 * 60 * 1000;

function calculateHaversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateDestinationPoint(lat, lng, distanceMeters, bearingDeg) {
  const R = 6371e3;
  const δ = distanceMeters / R;
  const θ = bearingDeg * Math.PI / 180;
  const φ1 = lat * Math.PI / 180;
  const λ1 = lng * Math.PI / 180;

  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);

  return {
    lat: (φ2 * 180) / Math.PI,
    lng: (λ2 * 180) / Math.PI
  };
}

const EXCLUDED_HEALTHCARE_KEYWORDS = [
  'pharmacy', 'chemist', 'drug store', 'medical & general store',
  'diagnostic center', 'diagnostic centre', 'pathology', 'laboratory', 'path lab',
  'dental', 'dentist', 'dental clinic', 'orthodontic',
  'veterinary', 'pet clinic', 'animal hospital',
  'beauty', 'wellness', 'spa', 'massage', 'cosmetic',
  'optical', 'optician', 'eye wear', 'spectacles'
];

function isLegitimateHospitalFacility(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  for (const kw of EXCLUDED_HEALTHCARE_KEYWORDS) {
    if (lower.includes(kw)) return false;
  }
  return true;
}

// TomTom Places Hospital Search Proxy Endpoint with Multi-Ring Coverage & Caching
app.get(['/api/places/hospitals', '/api/hospitals/search'], authenticateOptionalUser, async (req, res) => {
  try {
    const apiKey = process.env.TOMTOM_API_KEY || process.env.VITE_TOMTOM_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        error: 'TomTom API key not configured on server',
        results: []
      });
    }

    if (req.query.lat !== undefined && isNaN(parseFloat(req.query.lat))) {
      return res.status(400).json({ success: false, error: 'Invalid latitude parameter' });
    }
    if (req.query.lng !== undefined && isNaN(parseFloat(req.query.lng))) {
      return res.status(400).json({ success: false, error: 'Invalid longitude parameter' });
    }

    const lat = req.query.lat !== undefined ? parseFloat(req.query.lat) : 17.4435;
    const lng = req.query.lng !== undefined ? parseFloat(req.query.lng) : 78.3772;
    const radiusMeters = parseInt(req.query.radius) || 15000;
    const textQuery = (req.query.query || '').trim();

    // Check in-memory cache
    const cacheKey = `${lat.toFixed(3)}_${lng.toFixed(3)}_${radiusMeters}_${textQuery.toLowerCase()}`;
    const cachedEntry = serverHospitalCache.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.timestamp < HOSPITAL_CACHE_TTL_MS) {
      return res.json({
        success: true,
        count: cachedEntry.results.length,
        radiusMeters,
        results: cachedEntry.results,
        hospitals: cachedEntry.results,
        cached: true,
        provider: 'tomtom'
      });
    }

    const endpoints = [];

    if (textQuery.length >= 2) {
      // Text search targeting hospitals in POI category 7321
      const encodedQuery = encodeURIComponent(textQuery);
      endpoints.push(
        `https://api.tomtom.com/search/2/poiSearch/${encodedQuery}.json?key=${apiKey}&lat=${lat}&lon=${lng}&radius=${radiusMeters}&limit=100&categorySet=7321`
      );
    } else {
      // Radius discovery with multi-ring radial partitioning
      // Base center query (covers up to 5km density)
      endpoints.push(
        `https://api.tomtom.com/search/2/nearbySearch/.json?key=${apiKey}&lat=${lat}&lon=${lng}&radius=${Math.min(radiusMeters, 5000)}&limit=100&categorySet=7321`
      );

      // Ring 1: 5km to 15km (4 sub-centers at 9km, radius 8km)
      if (radiusMeters >= 15000) {
        const bearings = [0, 90, 180, 270];
        for (const b of bearings) {
          const pt = calculateDestinationPoint(lat, lng, 9000, b);
          endpoints.push(
            `https://api.tomtom.com/search/2/nearbySearch/.json?key=${apiKey}&lat=${pt.lat}&lon=${pt.lng}&radius=8000&limit=100&categorySet=7321`
          );
        }
      }

      // Ring 2: 15km to 25km (4 sub-centers at 19km, radius 9km)
      if (radiusMeters >= 25000) {
        const bearings = [45, 135, 225, 315];
        for (const b of bearings) {
          const pt = calculateDestinationPoint(lat, lng, 19000, b);
          endpoints.push(
            `https://api.tomtom.com/search/2/nearbySearch/.json?key=${apiKey}&lat=${pt.lat}&lon=${pt.lng}&radius=9000&limit=100&categorySet=7321`
          );
        }
      }

      // Ring 3: 25km to 50km (8 sub-centers at 36km, radius 16km)
      if (radiusMeters >= 50000) {
        const bearings = [0, 45, 90, 135, 180, 225, 270, 315];
        for (const b of bearings) {
          const pt = calculateDestinationPoint(lat, lng, 36000, b);
          endpoints.push(
            `https://api.tomtom.com/search/2/nearbySearch/.json?key=${apiKey}&lat=${pt.lat}&lon=${pt.lng}&radius=16000&limit=100&categorySet=7321`
          );
        }
      }
    }

    // Execute upstream requests with concurrency control and 429 exponential backoff
    async function fetchTomTomWithRetry(url, maxRetries = 2) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (res.status === 429) {
            if (attempt < maxRetries) {
              const delay = 150 * Math.pow(2, attempt);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.json();
        } catch (err) {
          if (attempt === maxRetries) throw err;
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    const rawMap = new Map();
    // Run in batches of 3 with 80ms stagger
    const CONCURRENCY = 3;
    for (let i = 0; i < endpoints.length; i += CONCURRENCY) {
      const batch = endpoints.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(batch.map(fetchTomTomWithRetry));
      for (const resp of batchResults) {
        if (resp.status === 'fulfilled' && Array.isArray(resp.value?.results)) {
          for (const r of resp.value.results) {
            if (r.id) rawMap.set(r.id, r);
          }
        }
      }
      if (i + CONCURRENCY < endpoints.length) {
        await new Promise(r => setTimeout(r, 80));
      }
    }

    // Also include any registered Supabase DB hospitals
    if (supabase) {
      try {
        const { data: dbHospitals } = await supabase.from('hospitals').select('*');
        if (dbHospitals && Array.isArray(dbHospitals)) {
          for (const dbH of dbHospitals) {
            const hLat = dbH.location?.coordinates ? dbH.location.coordinates[1] : null;
            const hLng = dbH.location?.coordinates ? dbH.location.coordinates[0] : null;
            if (hLat && hLng) {
              const d = Math.round(calculateHaversineMeters(lat, lng, hLat, hLng));
              if (d <= radiusMeters * 1.005) {
                rawMap.set(`db_${dbH.id}`, {
                  id: `db_${dbH.id}`,
                  isDbHospital: true,
                  dbId: dbH.id,
                  position: { lat: hLat, lon: hLng },
                  poi: { name: dbH.name, phone: dbH.phone },
                  address: { freeformAddress: dbH.address || dbH.name },
                  dist: d
                });
              }
            }
          }
        }
      } catch (dbErr) {
        // Non-blocking DB fetch error
      }
    }

    // Process, validate straight-line distance, filter exclusions, and deduplicate
    const hospitals = [];
    const spatialDeduplicationGrid = new Map();

    for (const r of rawMap.values()) {
      const hLat = r.position?.lat;
      const hLng = r.position?.lon;
      if (!hLat || !hLng) continue;

      const distMeters = Math.round(calculateHaversineMeters(lat, lng, hLat, hLng));

      // Strictly validate radius (exclude facilities beyond selected radius)
      if (distMeters > radiusMeters) continue;

      const name = r.poi?.name || 'Hospital';
      if (!r.isDbHospital && !isLegitimateHospitalFacility(name)) continue;

      // Spatial dedup: ~55m grid bucket
      const gridKey = `${Math.floor(hLat / 0.0005)}_${Math.floor(hLng / 0.0005)}`;
      const existing = spatialDeduplicationGrid.get(gridKey);
      if (
        existing &&
        (existing.name.toLowerCase() === name.toLowerCase() ||
          calculateHaversineMeters(existing.lat, existing.lng, hLat, hLng) < 25)
      ) {
        continue;
      }

      const normalized = {
        id: r.isDbHospital ? `db_${r.dbId}` : `tomtom_${r.id}`,
        providerId: r.isDbHospital ? r.dbId : r.id,
        provider: r.isDbHospital ? 'db' : 'tomtom',
        name,
        lat: hLat,
        lng: hLng,
        address:
          r.address?.freeformAddress ||
          `${r.address?.streetNumber || ''} ${r.address?.streetName || ''}`.trim() ||
          'Address unavailable',
        phone: r.poi?.phone || null,
        types: ['hospital'],
        distanceMeters: distMeters
      };

      spatialDeduplicationGrid.set(gridKey, normalized);
      hospitals.push(normalized);
    }

    // Sort strictly ascending by distance from search center
    hospitals.sort((a, b) => a.distanceMeters - b.distanceMeters);

    // Save to cache (limit cache size to 100 entries to prevent memory growth)
    if (serverHospitalCache.size > 100) {
      const oldestKey = serverHospitalCache.keys().next().value;
      serverHospitalCache.delete(oldestKey);
    }
    serverHospitalCache.set(cacheKey, { results: hospitals, timestamp: Date.now() });

    res.json({
      success: true,
      count: hospitals.length,
      radiusMeters,
      results: hospitals,
      hospitals: hospitals,
      cached: false,
      provider: 'tomtom'
    });
  } catch (error) {
    console.error('TomTom Places Hospital Search Error:', error.message || error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to search hospitals',
      results: []
    });
  }
});

// ============================================================================
// Hospital ER Readiness & Clinical Coordination Endpoints
// ============================================================================

const hospitalReadinessStore = new Map();

function createDefaultReadinessTasks(incidentId) {
  const now = new Date().toISOString();
  return [
    {
      id: `task_${incidentId}_trauma_bay`,
      taskType: 'trauma_bay',
      title: 'Trauma Resuscitation Bay 1',
      category: 'FACILITY',
      status: 'PENDING',
      isMandatory: true,
      assignedTo: null,
      assignedRole: 'Trauma Bay Nurse',
      updatedAt: now,
      updatedBy: null,
      notes: 'Bay cleared and medical priming pending verification'
    },
    {
      id: `task_${incidentId}_icu_bed`,
      taskType: 'icu_bed',
      title: 'ICU Critical Bed & Mechanical Ventilator',
      category: 'CRITICAL_CARE',
      status: 'PENDING',
      isMandatory: true,
      assignedTo: null,
      assignedRole: 'ICU Charge Staff',
      updatedAt: now,
      updatedBy: null,
      notes: 'Awaiting bed allocation and ventilator calibration'
    },
    {
      id: `task_${incidentId}_emergency_ot`,
      taskType: 'emergency_ot',
      title: 'Emergency Operating Theatre & Cath Lab',
      category: 'SURGICAL',
      status: 'PENDING',
      isMandatory: false,
      assignedTo: null,
      assignedRole: 'OT Coordinator',
      updatedAt: now,
      updatedBy: null,
      notes: 'Surgical suite on conditional standby'
    },
    {
      id: `task_${incidentId}_blood_bank`,
      taskType: 'blood_bank',
      title: 'Blood Bank Crossmatch & Emergency Units',
      category: 'BLOOD_BANK',
      status: 'PENDING',
      isMandatory: false,
      assignedTo: null,
      assignedRole: 'Transfusion Specialist',
      updatedAt: now,
      updatedBy: null,
      notes: 'O-Negative emergency reservation pending order'
    },
    {
      id: `task_${incidentId}_specialist_team`,
      taskType: 'specialist_team',
      title: 'On-Call Clinical Specialist Team',
      category: 'CLINICAL',
      status: 'PENDING',
      isMandatory: true,
      assignedTo: null,
      assignedRole: 'Specialist Physician',
      updatedAt: now,
      updatedBy: null,
      notes: 'Specialist team notification pending incident confirmation'
    }
  ];
}

function getOrInitReadinessState(incidentId) {
  let state = hospitalReadinessStore.get(incidentId);
  if (!state) {
    state = {
      incidentId,
      hospitalStatus: 'PENDING',
      bayReadinessConfirmed: false,
      confirmedAt: null,
      confirmedBy: null,
      assignedSpecialist: null,
      tasks: createDefaultReadinessTasks(incidentId),
      lastUpdatedAt: new Date().toISOString()
    };
    hospitalReadinessStore.set(incidentId, state);
  }
  return state;
}

// 1. Get current readiness state for an incident
app.get('/api/hospital/incidents/:id/readiness', authenticateOptionalUser, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'Incident ID required' });

    const state = getOrInitReadinessState(id);

    // Sync with Supabase emergency_incidents if available
    if (supabase) {
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        if (isUuid) {
          const { data: incident } = await supabase
            .from('emergency_incidents')
            .select('hospital_status, updated_at')
            .eq('id', id)
            .maybeSingle();

          if (incident?.hospital_status) {
            state.hospitalStatus = incident.hospital_status;
            if (incident.hospital_status === 'READY') {
              state.bayReadinessConfirmed = true;
            }
          }
        }
      } catch (dbErr) {
        console.warn('[Hospital Readiness] DB sync probe error:', dbErr.message);
      }
    }

    res.json({ success: true, readiness: state });
  } catch (error) {
    console.error('[Hospital Readiness] Error fetching readiness:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch hospital readiness state' });
  }
});

// 2. Update an individual readiness task
app.post('/api/hospital/incidents/:id/readiness/task', authenticateOptionalUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { taskId, status, notes, assignedTo, updatedBy } = req.body;

    if (!id || !taskId) {
      return res.status(400).json({ success: false, error: 'Incident ID and Task ID are required' });
    }

    const validStatuses = ['PENDING', 'IN_PROGRESS', 'READY', 'BLOCKED'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid task status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const state = getOrInitReadinessState(id);
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Readiness task not found' });
    }

    if (status) task.status = status;
    if (notes !== undefined) task.notes = notes;
    if (assignedTo !== undefined) task.assignedTo = assignedTo;
    task.updatedBy = updatedBy || req.user?.email || 'ER Clinical Staff';
    task.updatedAt = new Date().toISOString();
    state.lastUpdatedAt = task.updatedAt;

    // If all mandatory tasks are no longer READY, invalidate bay readiness confirmed state
    const mandatoryReady = state.tasks.filter(t => t.isMandatory).every(t => t.status === 'READY');
    if (!mandatoryReady && state.bayReadinessConfirmed) {
      state.bayReadinessConfirmed = false;
      state.hospitalStatus = 'PENDING';
      if (supabase) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        if (isUuid) {
          await supabase.from('emergency_incidents').update({ hospital_status: 'PENDING' }).eq('id', id);
        }
      }
    }

    res.json({ success: true, task, tasks: state.tasks, bayReadinessConfirmed: state.bayReadinessConfirmed });
  } catch (error) {
    console.error('[Hospital Readiness] Error updating task:', error);
    res.status(500).json({ success: false, error: 'Failed to update readiness task' });
  }
});

// 3. Confirm ER Bay Readiness (Validates mandatory tasks and updates DB)
app.post(['/api/hospital/incidents/:id/confirm-readiness', '/api/hospital/incidents/:id/confirm'], authenticateOptionalUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { confirmedBy } = req.body;

    if (!id) return res.status(400).json({ success: false, error: 'Incident ID required' });

    const state = getOrInitReadinessState(id);

    // Validate mandatory tasks
    const unreadyMandatory = state.tasks.filter(t => t.isMandatory && t.status !== 'READY');
    if (unreadyMandatory.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot confirm ER Bay Readiness: All mandatory clinical readiness tasks must be READY before confirmation.',
        unreadyTasks: unreadyMandatory.map(t => t.title)
      });
    }

    // Persist to Supabase emergency_incidents table
    const now = new Date().toISOString();
    const operator = confirmedBy || req.user?.email || 'ER Charge Physician';

    if (supabase) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (isUuid) {
        const { error: dbError } = await supabase
          .from('emergency_incidents')
          .update({ hospital_status: 'READY' })
          .eq('id', id);

        if (dbError) {
          console.error('[Hospital Readiness] Supabase update failed:', dbError);
          return res.status(500).json({ success: false, error: 'Database update failed: ' + dbError.message });
        }
      }
    }

    state.hospitalStatus = 'READY';
    state.bayReadinessConfirmed = true;
    state.confirmedAt = now;
    state.confirmedBy = operator;
    state.lastUpdatedAt = now;

    res.json({
      success: true,
      hospitalStatus: 'READY',
      bayReadinessConfirmed: true,
      confirmedAt: now,
      confirmedBy: operator,
      tasks: state.tasks
    });
  } catch (error) {
    console.error('[Hospital Readiness] Error confirming readiness:', error);
    res.status(500).json({ success: false, error: 'Failed to confirm hospital bay readiness' });
  }
});

// 4. Assign clinical specialist to incident
app.post('/api/hospital/incidents/:id/assign-specialist', authenticateOptionalUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, specialty, contact, assignedBy } = req.body;

    if (!id || !name?.trim()) {
      return res.status(400).json({ success: false, error: 'Incident ID and Specialist Name are required' });
    }

    const state = getOrInitReadinessState(id);
    const now = new Date().toISOString();

    state.assignedSpecialist = {
      name: name.trim(),
      specialty: specialty || 'Emergency Medicine',
      contact: contact || null,
      assignedAt: now,
      assignedBy: assignedBy || req.user?.email || 'ER Triage Desk'
    };

    // Auto-update specialist_team task to READY since a specialist has been actively assigned
    const specTask = state.tasks.find(t => t.taskType === 'specialist_team');
    if (specTask) {
      specTask.status = 'READY';
      specTask.assignedTo = state.assignedSpecialist.name;
      specTask.updatedAt = now;
      specTask.notes = `Assigned to ${state.assignedSpecialist.name} (${state.assignedSpecialist.specialty})`;
    }

    state.lastUpdatedAt = now;

    res.json({
      success: true,
      assignedSpecialist: state.assignedSpecialist,
      tasks: state.tasks
    });
  } catch (error) {
    console.error('[Hospital Readiness] Error assigning specialist:', error);
    res.status(500).json({ success: false, error: 'Failed to assign clinical specialist' });
  }
});

// 5. Get verified clinical staff and specialists from profiles
app.get('/api/hospital/specialists', authenticateOptionalUser, async (req, res) => {
  try {
    if (!supabase) return res.json({ success: true, specialists: [] });

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .in('role', ['hospital', 'hospital_operator', 'doctor', 'specialist']);

    if (error) {
      console.warn('[Hospital Readiness] Profile query failed:', error.message);
      return res.json({ success: true, specialists: [] });
    }

    const specialists = (data || []).map(p => ({
      id: p.id,
      name: p.full_name || 'Staff Physician',
      role: p.role,
      phone: p.phone || null,
      organization: p.organization || 'Emergency Department'
    }));

    res.json({ success: true, specialists });
  } catch (error) {
    console.error('[Hospital Readiness] Error fetching specialists:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch specialists', specialists: [] });
  }
});

// 6. Get verified hospitals list from database
app.get('/api/hospital/list', authenticateOptionalUser, async (req, res) => {
  try {
    if (!supabase) return res.json({ success: true, hospitals: [] });
    const { data, error } = await supabase.from('hospitals').select('*');
    if (error) {
      console.warn('[Hospital API] Error querying hospitals:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
    const hospitals = (data || []).map(h => ({
      id: h.id,
      name: h.name,
      address: h.address || '',
      location: (h.location && h.location.coordinates) 
        ? { latitude: h.location.coordinates[1], longitude: h.location.coordinates[0] } 
        : { latitude: 17.4485, longitude: 78.5303 },
      phone: h.phone,
      emergencyCapable: h.emergency_capable,
      totalBeds: h.total_beds,
      availableIcuBeds: h.available_icu_beds,
      traumaBaysAvailable: h.trauma_bays_available,
    }));
    res.json({ success: true, hospitals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Get incoming active emergency incidents for a destination hospital
app.get('/api/hospital/incidents', authenticateOptionalUser, async (req, res) => {
  try {
    if (!supabase) return res.json({ success: true, incidents: [] });
    const { hospital } = req.query;
    let query = supabase
      .from('emergency_incidents')
      .select('*')
      .in('status', ['active', 'dispatched', 'en_route', 'rerouting', 'arrived'])
      .order('created_at', { ascending: false });

    if (hospital) {
      query = query.eq('destination_hospital', hospital);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[Hospital API] Error querying incidents:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, incidents: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// ADMIN DASHBOARD & ANALYTICS API ENDPOINTS
// Authoritative aggregation from real database records
// ==========================================

// 8. Admin Overview KPI Metrics
app.get('/api/admin/overview', authenticateOptionalUser, async (req, res) => {
  try {
    if (!supabase) {
      return res.json({
        success: true,
        data: {
          activeEmergencies: 0,
          completedIncidents: 0,
          cancelledIncidents: 0,
          totalIncidents: 0,
          onlineAmbulances: 0,
          availablePolice: 0,
          partnerHospitals: 0,
          avgResponseTimeMins: null,
          corridorClearanceRatePercent: null,
          timestamp: new Date().toISOString()
        }
      });
    }

    // 1. Query incidents
    const { data: incidents, error: incError } = await supabase
      .from('emergency_incidents')
      .select('id, status, created_at, resolved_at, corridor_status, route_duration_seconds, traffic_duration_seconds');

    if (incError) {
      console.warn('[Admin API] Incident query error:', incError.message);
      return res.status(500).json({ success: false, error: incError.message });
    }

    const allIncidents = incidents || [];
    const active = allIncidents.filter(i => ['active', 'dispatched', 'en_route', 'rerouting', 'arrived'].includes(i.status));
    const completed = allIncidents.filter(i => ['resolved', 'completed', 'arrived'].includes(i.status));
    const cancelled = allIncidents.filter(i => i.status === 'cancelled');

    // Calculate response time ONLY from records with valid created_at and resolved_at
    const resolvedWithTimes = allIncidents.filter(i => i.created_at && i.resolved_at && new Date(i.resolved_at) > new Date(i.created_at));
    let avgResponseTimeMins = null;
    if (resolvedWithTimes.length > 0) {
      const totalMs = resolvedWithTimes.reduce((acc, curr) => {
        return acc + (new Date(curr.resolved_at).getTime() - new Date(curr.created_at).getTime());
      }, 0);
      avgResponseTimeMins = parseFloat((totalMs / resolvedWithTimes.length / 60000).toFixed(1));
    }

    // Calculate corridor clearance rate from real corridor updates
    const incidentsWithCorridorAction = allIncidents.filter(i => i.corridor_status && i.corridor_status !== 'PENDING');
    let corridorClearanceRatePercent = null;
    if (incidentsWithCorridorAction.length > 0) {
      const clearCount = incidentsWithCorridorAction.filter(i => i.corridor_status === 'CLEAR').length;
      corridorClearanceRatePercent = Math.round((clearCount / incidentsWithCorridorAction.length) * 100);
    }

    // 2. Query registered units from profiles
    const { data: profiles, error: profError } = await supabase
      .from('profiles')
      .select('id, role');

    const allProfiles = profError ? [] : (profiles || []);
    const onlineAmbulances = allProfiles.filter(p => ['AMBULANCE', 'AMBULANCE_OPERATOR', 'ambulance'].includes(p.role)).length;
    const availablePolice = allProfiles.filter(p => ['POLICE', 'POLICE_OFFICER', 'police'].includes(p.role)).length;

    // 3. Query partner hospitals
    const { count: hospitalCount, error: hospError } = await supabase
      .from('hospitals')
      .select('*', { count: 'exact', head: true });

    const partnerHospitals = hospError ? 0 : (hospitalCount || 0);

    res.json({
      success: true,
      data: {
        activeEmergencies: active.length,
        completedIncidents: completed.length,
        cancelledIncidents: cancelled.length,
        totalIncidents: allIncidents.length,
        onlineAmbulances,
        availablePolice,
        partnerHospitals,
        avgResponseTimeMins,
        corridorClearanceRatePercent,
        hasResponseTimeData: resolvedWithTimes.length > 0,
        hasCorridorData: incidentsWithCorridorAction.length > 0,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[Admin API] Error compiling overview:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Admin Analytics: Breakdown by category, status, and timeline
app.get('/api/admin/analytics', authenticateOptionalUser, async (req, res) => {
  try {
    if (!supabase) {
      return res.json({
        success: true,
        data: {
          categoryDistribution: [],
          statusDistribution: [],
          timelineVolume: [],
          responseTimesList: [],
          totalRecords: 0
        }
      });
    }

    const { data: incidents, error } = await supabase
      .from('emergency_incidents')
      .select('id, status, incident_type, priority, created_at, resolved_at, corridor_status, route_duration_seconds, traffic_duration_seconds')
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    const records = incidents || [];

    // Category Distribution (by real incident_type)
    const categoryCounts = {};
    records.forEach(r => {
      const cat = r.incident_type || 'Unspecified';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
    const categoryDistribution = Object.entries(categoryCounts).map(([name, value]) => ({ name, value }));

    // Status Distribution (by real status)
    const statusCounts = {};
    records.forEach(r => {
      const stat = (r.status || 'unknown').toUpperCase();
      statusCounts[stat] = (statusCounts[stat] || 0) + 1;
    });
    const statusDistribution = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

    // Timeline volume grouped by date
    const dateCounts = {};
    records.forEach(r => {
      if (r.created_at) {
        const dateStr = new Date(r.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
        if (!dateCounts[dateStr]) dateCounts[dateStr] = { date: dateStr, count: 0, cleared: 0 };
        dateCounts[dateStr].count += 1;
        if (r.corridor_status === 'CLEAR') dateCounts[dateStr].cleared += 1;
      }
    });
    const timelineVolume = Object.values(dateCounts);

    // Response times from valid resolved incidents
    const responseTimesList = records
      .filter(r => r.created_at && r.resolved_at && new Date(r.resolved_at) > new Date(r.created_at))
      .slice(-10)
      .map(r => ({
        id: r.id.slice(0, 8),
        date: new Date(r.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }),
        durationMinutes: parseFloat(((new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime()) / 60000).toFixed(1)),
        estimatedEtaMinutes: r.route_duration_seconds ? parseFloat((r.route_duration_seconds / 60).toFixed(1)) : null
      }));

    res.json({
      success: true,
      data: {
        categoryDistribution,
        statusDistribution,
        timelineVolume,
        responseTimesList,
        totalRecords: records.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[Admin API] Error compiling analytics:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Admin Emergency Incidents with Filters and Search
app.get('/api/admin/incidents', authenticateOptionalUser, async (req, res) => {
  try {
    if (!supabase) return res.json({ success: true, incidents: [], total: 0 });

    const { status, category, search, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('emergency_incidents')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status && status !== 'ALL') {
      if (status === 'ACTIVE') {
        query = query.in('status', ['active', 'dispatched', 'en_route', 'rerouting', 'arrived']);
      } else if (status === 'COMPLETED') {
        query = query.in('status', ['resolved', 'completed', 'arrived']);
      } else if (status === 'CANCELLED') {
        query = query.eq('status', 'cancelled');
      } else {
        query = query.eq('status', status.toLowerCase());
      }
    }

    if (category && category !== 'ALL') {
      query = query.eq('incident_type', category);
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`id.ilike.${term},ambulance_id.ilike.${term},destination_hospital.ilike.${term}`);
    }

    const { data, count, error } = await query;
    if (error) {
      console.warn('[Admin API] Incidents query error:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      incidents: data || [],
      total: count || (data ? data.length : 0),
      limit: Number(limit),
      offset: Number(offset)
    });
  } catch (err) {
    console.error('[Admin API] Error fetching incidents:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`AERO AI Backend Server running on port ${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const fallbackPort = Number(PORT) + 1;
    console.warn(`Port ${PORT} in use, trying ${fallbackPort}...`);
    app.listen(fallbackPort, '0.0.0.0', () => {
      console.log(`AERO AI Backend Server running on port ${fallbackPort}`);
    });
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
