import { Router } from 'express';
import { isAuthenticated } from '../middleware/auth.js';
import {
  createCheckoutSession,
  getSubscriptionStatus,
  createPortalSession,
  getInvoices,
  cancelSubscription,
  reactivateSubscription,
  changePlan,
  handleWebhook,
} from '../controllers/billingController.js';

const router = Router();

// Webhook endpoint (no auth required, raw body handled at app level)
router.post('/webhook', handleWebhook);

// Protected routes (require authentication)
router.use(isAuthenticated);

// Subscription management
router.post('/checkout', createCheckoutSession);
router.get('/subscription', getSubscriptionStatus);
router.post('/portal', createPortalSession);
router.get('/invoices', getInvoices);
router.post('/cancel', cancelSubscription);
router.post('/reactivate', reactivateSubscription);
router.post('/change-plan', changePlan);

export default router;

