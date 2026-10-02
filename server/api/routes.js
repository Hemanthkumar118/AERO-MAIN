import express from 'express';
import { GoogleRoutesService } from '../services/google_routes_service.js';

const router = express.Router();
const googleRoutesService = new GoogleRoutesService();

router.post('/calculate', async (req, res) => {
  try {
    const { origin, destination } = req.body;
    
    if (!origin || !destination) {
      return res.status(400).json({ error: 'Origin and destination are required.' });
    }

    const routes = await googleRoutesService.getTrafficAwareRoute(origin, destination);
    
    return res.json({
      status: 'success',
      routes
    });
  } catch (error) {
    console.error('[Routing API] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to calculate route',
      details: error.message
    });
  }
});

import { GooglePlacesService } from '../services/google_places_service.js';
const googlePlacesService = new GooglePlacesService();

router.post('/hospitals/search', async (req, res) => {
  try {
    const { lat, lng, radiusMeters, query } = req.body;
    
    if (!lat || !lng || !radiusMeters) {
      return res.status(400).json({ error: 'lat, lng, and radiusMeters are required.' });
    }

    const places = await googlePlacesService.searchNearby(lat, lng, radiusMeters, query);
    
    return res.json({
      status: 'success',
      places
    });
  } catch (error) {
    console.error('[Hospital Search API] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to search hospitals',
      details: error.message
    });
  }
});

export default router;
