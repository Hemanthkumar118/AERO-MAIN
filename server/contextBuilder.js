/**
 * AERO Chatbot Context Builder
 * Securely fetches context from the database based on the authenticated user's role and intent.
 */

export const detectAeroIntent = async (message, groq) => {
  if (!groq) return ['ACTIVE_EMERGENCY']; // Fallback

  try {
    const prompt = `
You are an intent classifier for an emergency response system (AERO).
Identify which data domains the user needs to answer their query.
Return a JSON object with a single key "intents" containing an array of strings from the following list:
- ACTIVE_EMERGENCY: Queries about current ETA, location, destination, active incident status, route, speed.
- HISTORY: Queries about past emergencies or incident history.
- HOSPITAL: Queries about hospital details, arriving ambulances (for hospital staff).
- POLICE: Queries about junctions, traffic, alerts (for police).
- PROFILE: Queries about the user's own profile (name, badge, vehicle number).
- GENERAL: General greetings or questions that do not require live database information.

User message: "${message}"
`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'system', content: prompt }],
      model: 'llama-3.1-8b-instant',
      temperature: 0,
      response_format: { type: "json_object" }
    });

    const reply = chatCompletion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(reply);
    
    if (parsed.intents && Array.isArray(parsed.intents)) {
      return parsed.intents;
    }
    
    return ['ACTIVE_EMERGENCY'];
  } catch (err) {
    console.error("Intent classification failed:", err);
    return ['ACTIVE_EMERGENCY']; // default to active emergency if it fails
  }
};

export const buildAeroChatContext = async (userId, role, intents, supabase) => {
  const context = {
    user: { id: userId, role }
  };

  try {
    // 1. Profile Data
    if (intents.includes('PROFILE') || intents.includes('ACTIVE_EMERGENCY')) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, badge_number, station_name')
        .eq('id', userId)
        .single();
      
      if (profile) {
        context.user.name = profile.full_name;
        context.user.badge = profile.badge_number;
        context.user.station = profile.station_name;
      }
    }

    // 2. Active Emergency Data (For Ambulance Drivers / Police)
    if (intents.includes('ACTIVE_EMERGENCY') && (role === 'ambulance_operator' || role === 'traffic_operator' || role === 'admin')) {
      
      // If Ambulance Operator, get their ambulance and active incident
      if (role === 'ambulance_operator') {
        const { data: ambulance } = await supabase
          .from('ambulances')
          .select('id, vehicle_number, current_status, equipment_level')
          .eq('driver_id', userId)
          .single();
        
        if (ambulance) {
          context.ambulance = ambulance;

          // Get latest telemetry
          const { data: telemetry } = await supabase
            .from('location_telemetry')
            .select('location, speed, heading, accuracy, timestamp')
            .eq('entity_id', ambulance.id)
            .order('timestamp', { ascending: false })
            .limit(1)
            .single();

          if (telemetry) {
            context.ambulance.lastTelemetry = {
              coordinates: telemetry.location?.coordinates,
              speedKmh: telemetry.speed,
              heading: telemetry.heading,
              accuracyMeters: telemetry.accuracy,
              timestamp: telemetry.timestamp
            };
          }

          // Get active emergency for this user
          const { data: activeEmergency } = await supabase
            .from('emergency_incidents')
            .select('id, status, category, priority, destination_address, route_distance_meters, route_duration_seconds, created_at, hospitals(name, address)')
            .eq('user_id', userId)
            .in('status', ['PENDING', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED_AT_HOSPITAL'])
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (activeEmergency) {
            context.activeEmergency = {
              id: activeEmergency.id,
              status: activeEmergency.status,
              category: activeEmergency.category,
              priority: activeEmergency.priority,
              destinationAddress: activeEmergency.destination_address,
              destinationHospital: activeEmergency.hospitals?.name,
              routeDistanceKm: activeEmergency.route_distance_meters ? (activeEmergency.route_distance_meters / 1000).toFixed(2) : null,
              etaMinutes: activeEmergency.route_duration_seconds ? Math.round(activeEmergency.route_duration_seconds / 60) : null
            };
          }
        }
      }

      // If Traffic Operator, get active incidents in their jurisdiction or generally active
      if (role === 'traffic_operator') {
        // They might be assigned to a junction
        const { data: junctions } = await supabase
          .from('junctions')
          .select('id, name, status, location')
          .eq('assigned_police_id', userId);
        
        if (junctions && junctions.length > 0) {
          context.police = { assignedJunctions: junctions };
        }

        // Check for approaching emergencies (corridor_status not null, or ACTIVE)
        const { data: incomingEmergencies } = await supabase
          .from('emergency_incidents')
          .select('id, status, category, priority, corridor_status, route_duration_seconds, destination_address')
          .in('status', ['EN_ROUTE'])
          .order('updated_at', { ascending: false })
          .limit(3);
        
        if (incomingEmergencies && incomingEmergencies.length > 0) {
          context.incomingEmergencies = incomingEmergencies.map(e => ({
            id: e.id,
            status: e.status,
            corridorStatus: e.corridor_status,
            priority: e.priority,
            etaMinutes: e.route_duration_seconds ? Math.round(e.route_duration_seconds / 60) : null,
            destination: e.destination_address
          }));
        }
      }
    }

    // 3. Hospital Data (For Hospital Operators)
    if (intents.includes('HOSPITAL') || (role === 'hospital_operator' && intents.includes('ACTIVE_EMERGENCY'))) {
      const { data: hospital } = await supabase
        .from('hospitals')
        .select('id, name, available_icu_beds, trauma_bays_available, emergency_capable')
        .limit(1)
        .single(); // Assuming 1 hospital linked for now, or could link to profile

      if (hospital) {
        context.hospital = hospital;

        // Get incoming ambulances to this hospital
        const { data: incoming } = await supabase
          .from('emergency_incidents')
          .select('id, status, category, priority, route_duration_seconds')
          .eq('hospital_id', hospital.id)
          .in('status', ['ACCEPTED', 'EN_ROUTE']);
        
        if (incoming && incoming.length > 0) {
          context.incomingAmbulances = incoming.map(e => ({
            id: e.id,
            category: e.category,
            priority: e.priority,
            status: e.status,
            etaMinutes: e.route_duration_seconds ? Math.round(e.route_duration_seconds / 60) : null
          }));
        }
      }
    }

    // 4. History Data
    if (intents.includes('HISTORY')) {
      const { data: history } = await supabase
        .from('emergency_incidents')
        .select('id, status, category, priority, created_at, resolved_at')
        .eq('user_id', userId)
        .in('status', ['COMPLETED', 'RESOLVED'])
        .order('created_at', { ascending: false })
        .limit(5);

      if (history) {
        context.emergencyHistory = history;
      }
    }

  } catch (err) {
    console.error("Context Builder Error:", err);
  }

  return context;
};
