import express from 'express';
import { MapplsService } from '../services/mappls_service.js';

const router = express.Router();
const mapplsService = new MapplsService();

router.post('/calculate', async (req, res) => {
  try {
    const { origin, destination } = req.body;
    
    if (!origin || !destination) {
      return res.status(400).json({ error: 'Origin and destination are required.' });
    }

    const routes = await mapplsService.getTrafficAwareRoute(origin, destination);
    
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

export default router;
