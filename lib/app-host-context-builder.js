import logger from './logger.js';

function getQueryTypes(db) {
  return db.sequelize.constructor.QueryTypes;
}

function buildAppServices(db, appId) {
  const QueryTypes = getQueryTypes(db);

  return {
    query: async (sql, replacements = []) => {
      return await db.sequelize.query(sql, {
        replacements,
        type: QueryTypes.SELECT,
      });
    },
    execute: async (sql, replacements = []) => {
      return await db.sequelize.query(sql, {
        replacements,
        type: QueryTypes.RAW,
      });
    },
    getModel: (modelName) => {
      return db.getModel(modelName);
    },
    log: (level, message, meta = {}) => {
      if (level === 'error') {
        logger.error(`[App:${appId}] ${message}`, meta);
      } else if (level === 'warn') {
        logger.warn(`[App:${appId}] ${message}`, meta);
      } else {
        logger.info(`[App:${appId}] ${message}`, meta);
      }
    },
  };
}

export function buildAppHostContext({
  db,
  appId,
  appRecord = null,
  requestContext = null,
} = {}) {
  if (!db) {
    throw new Error('buildAppHostContext requires db');
  }
  if (!appId) {
    throw new Error('buildAppHostContext requires appId');
  }

  const session = requestContext?.state?.session || null;

  return {
    db,
    appId,
    app_id: appId,
    app: appRecord,
    request: requestContext,
    user: session,
    services: buildAppServices(db, appId),
  };
}

export default buildAppHostContext;
