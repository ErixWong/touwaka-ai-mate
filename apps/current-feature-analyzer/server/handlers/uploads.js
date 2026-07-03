import multer from '@koa/multer';
import {
  ConfigService,
  RuleSetService,
  UploadSessionService,
  CsvParseService,
} from '../services/index.js';
import logger from '../../../../lib/logger.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Handler 元数据：声明上传配置
export const route = {
  path: '/uploads',
  upload: {
    fields: [{ name: 'files', maxCount: 50 }],
  },
};

// 保持向后兼容：旧代码可能使用 config.multer
export const config = {
  multer: upload,
};

function getUserId(ctx) {
  return ctx.state.session?.id || ctx.state.user?.id || null;
}

function getSession(ctx) {
  return ctx.state.session || {};
}

function isAdmin(ctx) {
  const session = getSession(ctx);
  return session.isAdmin || false;
}

function requireAdmin(ctx) {
  if (!isAdmin(ctx)) {
    ctx.error('Admin required', 403);
    return false;
  }
  return true;
}

function readUploadedFileSync(f) {
  if (f.buffer) return f.buffer.toString('utf-8');
  if (f.data) return typeof f.data === 'string' ? f.data : f.data.toString('utf-8');
  throw new Error('无法读取上传文件：仅支持内存存储模式');
}

export async function post(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    if (!userId) { ctx.error('Unauthorized', 401); return; }

    const files = ctx.files?.files || ctx.request.files?.files;
    if (!files || files.length === 0) {
      ctx.error('请至少上传一个 CSV 文件', 400);
      return;
    }

    const uploadSessionService = new UploadSessionService(deps.db);
    const csvParseService = new CsvParseService(deps.db);

    const fileList = Array.isArray(files) ? files : [files];
    const batch = uploadSessionService.createBatch(
      fileList.map(f => f.originalname || f.originalFilename || f.name || 'unknown.csv'),
      userId
    );

    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      try {
        const text = readUploadedFileSync(f);
        const parsed = csvParseService.parse(text);

        if (parsed.error) {
          uploadSessionService.setFileError(batch.batch_id, batch.files[i].file_id, parsed.error);
          continue;
        }

        uploadSessionService.setFileRawData(
          batch.batch_id, batch.files[i].file_id, parsed.points, {
            row_count: parsed.point_count,
            time_column: parsed.time_column,
            current_column: parsed.current_column,
            file_size: f.size || 0,
          }
        );

        if (parsed.duplicate_diagnosis) {
          const file = uploadSessionService.getBatch(batch.batch_id).files[i];
          file._duplicate_diagnosis = parsed.duplicate_diagnosis;
        }
      } catch (fileErr) {
        logger.error(`[cfa] file parse error: ${fileErr.message}`);
        uploadSessionService.setFileError(batch.batch_id, batch.files[i].file_id, fileErr.message);
      }
    }

    ctx.success(uploadSessionService.getBatch(batch.batch_id));
  } catch (err) {
    logger.error('[cfa] upload error:', err.message);
    ctx.error(err.message, 500);
  }
}