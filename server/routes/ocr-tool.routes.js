import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

const router = new Router();

router.post('/api/ocr/analyze', authenticate(), async (ctx) => {
  await ctx.state.controllers.ocrTool.analyze(ctx);
});

router.get('/api/ocr/status/:taskId', authenticate(), async (ctx) => {
  await ctx.state.controllers.ocrTool.getStatus(ctx);
});

router.get('/api/ocr/presets', authenticate(), async (ctx) => {
  await ctx.state.controllers.ocrTool.getPromptPresets(ctx);
});

export default router;
