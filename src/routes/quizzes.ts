import { Router } from 'express';
import { isAuthenticated } from '../middleware/auth.js';
import * as quizController from '../controllers/quizController.js';

const router = Router();

// All routes require authentication
router.use(isAuthenticated);

// ============================================
// AI Generation Endpoints
// ============================================

// POST /api/quizzes/generate-questions
router.post('/generate-questions', quizController.generateQuestionsHandler);

// POST /api/quizzes/generate-results
router.post('/generate-results', quizController.generateResultsHandler);

// POST /api/quizzes/generate-mapping
router.post('/generate-mapping', quizController.generateMappingHandler);

// ============================================
// CRUD Operations
// ============================================

// POST /api/quizzes - Create new quiz
router.post('/', quizController.create);

// GET /api/quizzes - Get all quizzes for user
router.get('/', quizController.getAll);

// GET /api/quizzes/:id - Get single quiz
router.get('/:id', quizController.getOne);

// PATCH /api/quizzes/:id - Update quiz
router.patch('/:id', quizController.update);

// DELETE /api/quizzes/:id - Delete quiz
router.delete('/:id', quizController.remove);

// ============================================
// Publishing
// ============================================

// POST /api/quizzes/:id/publish - Publish quiz
router.post('/:id/publish', quizController.publish);

// POST /api/quizzes/:id/unpublish - Unpublish quiz
router.post('/:id/unpublish', quizController.unpublish);

// ============================================
// Responses & Analytics
// ============================================

// GET /api/quizzes/:id/responses - Get quiz responses
router.get('/:id/responses', quizController.getResponses);

// GET /api/quizzes/:id/responses/export - Export responses as CSV
router.get('/:id/responses/export', quizController.exportResponsesCsv);

// GET /api/quizzes/:id/analytics - Get quiz analytics
router.get('/:id/analytics', quizController.getAnalytics);

export default router;

