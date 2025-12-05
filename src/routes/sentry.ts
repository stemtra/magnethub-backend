import express from 'express';
import { notifySlackError } from '../controllers/sentryController.js';

const router: express.Router = express.Router();

// Simple endpoint to receive error notifications from frontend
router.post('/error', express.json(), notifySlackError);

export default router;
