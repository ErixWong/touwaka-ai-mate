import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router();
  const auth = authenticate();

  router.get('/api/els/dashboard', auth, (ctx) => controller.getDashboard(ctx));
  router.get('/api/els/materials/recommended', auth, (ctx) => controller.getRecommendedMaterials(ctx));
  router.get('/api/els/materials/:materialId', auth, (ctx) => controller.getMaterial(ctx));
  router.get('/api/els/materials/:materialId/quiz', auth, (ctx) => controller.getMaterialQuiz(ctx));
  router.post('/api/els/materials/:materialId/quiz/submit', auth, (ctx) => controller.submitMaterialQuiz(ctx));

  router.get('/api/els/libraries', auth, (ctx) => controller.getLibraries(ctx));
  router.post('/api/els/libraries/select', auth, (ctx) => controller.selectLibrary(ctx));
  router.get('/api/els/libraries/:libraryId/materials', auth, (ctx) => controller.getLibraryMaterials(ctx));

  router.post('/api/els/materials', auth, (ctx) => controller.createMaterial(ctx));
  router.put('/api/els/materials/:materialId', auth, (ctx) => controller.updateMaterial(ctx));

  router.get('/api/els/notebooks', auth, (ctx) => controller.getNotebooks(ctx));
  router.post('/api/els/notebooks/select', auth, (ctx) => controller.selectNotebook(ctx));

  router.post('/api/els/words', auth, (ctx) => controller.collectWord(ctx));
  router.get('/api/els/words/:wordId', auth, (ctx) => controller.getWord(ctx));

  router.get('/api/els/reviews', auth, (ctx) => controller.getReviews(ctx));
  router.post('/api/els/reviews/submit', auth, (ctx) => controller.submitReviews(ctx));

  router.get('/api/els/checkin', auth, (ctx) => controller.getCheckin(ctx));

  return router;
};
