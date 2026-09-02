import { DataTypes } from "sequelize";

const DEFAULT_MODEL_NAME = "llm_kit_transcript";
const DEFAULT_TABLE_NAME = "llm_kit_transcripts";
const RUN_STATE_TABLE_NAME = "llm_kit_run_state";

const META_COLUMNS = [
  ["topicId", "topic_id"],
  ["userId", "user_id"],
  ["expertId", "expert_id"],
  ["modelName", "model_name"],
  ["providerName", "provider_name"],
  ["usage", "usage"],
  ["latencyMs", "latency_ms"],
  ["errorInfo", "error_info"],
  ["isDeleted", "is_deleted"],
];

function modelNameForTable(tableName) {
  return tableName === DEFAULT_TABLE_NAME
    ? DEFAULT_MODEL_NAME
    : `${DEFAULT_MODEL_NAME}_${tableName}`;
}

function defineTranscriptModel(sequelize, tableName) {
  const modelName = modelNameForTable(tableName);
  return sequelize.models[modelName] ?? sequelize.define(modelName, {
    run_id: {
      type: DataTypes.STRING(128),
      allowNull: false,
      primaryKey: true,
    },
    round: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
    },
    ts: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    folded: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    messages: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    folded_payload: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    topic_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    user_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    expert_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    model_name: {
      type: DataTypes.STRING(128),
      allowNull: true,
    },
    provider_name: {
      type: DataTypes.STRING(128),
      allowNull: true,
    },
    usage: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    latency_ms: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    error_info: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  }, {
    tableName,
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "idx_llm_kit_transcripts_topic_id",
        fields: ["topic_id"],
      },
      {
        name: "idx_llm_kit_transcripts_user_id",
        fields: ["user_id"],
      },
    ],
  });
}

function parseJsonColumn(value) {
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

function isMissingRunStateTableError(error) {
  return [error, error?.parent, error?.original].some((candidate) => (
    candidate?.code === "ER_NO_SUCH_TABLE" || candidate?.errno === 1146
  ));
}

function toRecord(row) {
  const record = {
    round: row.round,
    ts: row.ts,
    folded: Boolean(row.folded),
    messages: parseJsonColumn(row.messages),
  };
  const foldedPayload = parseJsonColumn(row.folded_payload);
  if (foldedPayload !== null && foldedPayload !== undefined) {
    record.foldedPayload = foldedPayload;
  }
  return record;
}

function metaToColumns(meta = {}) {
  const columns = {};
  for (const [metaKey, columnName] of META_COLUMNS) {
    if (metaKey === "isDeleted") {
      columns[columnName] = meta[metaKey] ?? false;
    } else {
      columns[columnName] = meta[metaKey] ?? null;
    }
  }
  return columns;
}

function rowToMeta(row) {
  const meta = {};
  for (const [metaKey, columnName] of META_COLUMNS) {
    if (metaKey === "isDeleted") {
      meta[metaKey] = Boolean(row[columnName]);
    } else if (metaKey === "usage" || metaKey === "errorInfo") {
      meta[metaKey] = parseJsonColumn(row[columnName]);
    } else {
      meta[metaKey] = row[columnName];
    }
  }
  return meta;
}

function toRecordWithMeta(row) {
  return {
    ...toRecord(row),
    meta: rowToMeta(row),
  };
}

function blocksFor(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

function blockText(block) {
  if (!block || typeof block !== "object") return null;
  if (block.type === "text") return String(block.text ?? "");
  if (block.type === "tool_use") {
    return `${block.name ?? ""}${JSON.stringify(block.input)}`;
  }
  if (block.type === "tool_result") return String(block.content ?? "");
  return null;
}

function appendFragments(fragments, messages) {
  for (const message of messages ?? []) {
    for (const block of blocksFor(message?.content)) {
      const text = blockText(block);
      if (text !== null) fragments.push(text);
    }
  }
}

/**
 * Create a MariaDB-backed TranscriptStore.
 *
 * The model is defined here but is not synchronized automatically. Call the
 * returned store's sync() during application or test setup.
 *
 * @param {{
 *   db: {sequelize: import("sequelize").Sequelize},
 *   tableName?: string
 * }} options
 * @returns {{
 *   appendRound: (runId:string, record:object, meta?:object) => Promise<void>,
 *   load: (runId:string) => Promise<object[]>,
 *   loadWithMeta: (runId:string) => Promise<object[]>,
 *   findByTopic: (topicId:string, options?:{limit?:number}) => Promise<object[]>,
 *   recall: (runId:string, fromRound?:number, toRound?:number, pattern?:string) => Promise<string>,
 *   markRunState: (runId:string, state:string) => Promise<void>,
 *   saveCheckpoint: (runId:string, checkpoint:object) => Promise<void>,
 *   appendCheckpoint: (runId:string, checkpoint:object) => Promise<void>,
 *   loadLatestCheckpoint: (runId:string) => Promise<object|undefined>,
 *   sync: (options?:object) => Promise<object>
 * }}
 */
export function createTouwakaTranscriptStore({ db, tableName = DEFAULT_TABLE_NAME }) {
  if (!db?.sequelize) throw new Error("[llm-kit-adapters] db 实例必填");

  const Transcript = defineTranscriptModel(db.sequelize, tableName);
  const runStateQuery = async (sql, replacements) => {
    try {
      return await db.sequelize.query(sql, { replacements });
    } catch (error) {
      if (isMissingRunStateTableError(error)) {
        throw new Error(
          `[llm-kit-adapters] ${RUN_STATE_TABLE_NAME} 表不存在，请先运行 scripts/upgrade-database.js`,
          { cause: error },
        );
      }
      throw error;
    }
  };

  const markRunState = async (runId, state) => {
    await runStateQuery(`
      INSERT INTO ${RUN_STATE_TABLE_NAME} (run_id, state, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        state = VALUES(state),
        updated_at = CURRENT_TIMESTAMP
    `, [runId, state]);
  };

  const saveCheckpoint = async (runId, checkpoint) => {
    await runStateQuery(`
      INSERT INTO ${RUN_STATE_TABLE_NAME} (run_id, checkpoint, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        checkpoint = VALUES(checkpoint),
        updated_at = CURRENT_TIMESTAMP
    `, [runId, JSON.stringify(checkpoint)]);
  };

  const loadLatestCheckpoint = async (runId) => {
    const [rows] = await runStateQuery(`
      SELECT checkpoint
      FROM ${RUN_STATE_TABLE_NAME}
      WHERE run_id = ?
      LIMIT 1
    `, [runId]);
    const checkpoint = rows[0]?.checkpoint;
    return checkpoint === null || checkpoint === undefined
      ? undefined
      : parseJsonColumn(checkpoint);
  };

  return {
    async appendRound(runId, record, meta) {
      await Transcript.create({
        run_id: runId,
        round: record.round,
        ts: record.ts,
        folded: record.folded ?? false,
        messages: record.messages,
        folded_payload: record.foldedPayload ?? null,
        ...metaToColumns(meta ?? record.meta),
      });
    },

    async load(runId) {
      const rows = await Transcript.findAll({
        where: { run_id: runId },
        order: [["round", "ASC"]],
        raw: true,
      });
      return rows.map(toRecord);
    },

    async loadWithMeta(runId) {
      const rows = await Transcript.findAll({
        where: { run_id: runId },
        order: [["round", "ASC"]],
        raw: true,
      });
      return rows.map(toRecordWithMeta);
    },

    async findByTopic(topicId, options = {}) {
      const query = {
        where: { topic_id: topicId },
        order: [["run_id", "ASC"], ["round", "ASC"]],
        raw: true,
      };
      if (Number.isInteger(options?.limit) && options.limit >= 0) {
        query.limit = options.limit;
      }
      const rows = await Transcript.findAll(query);
      return rows.map(toRecordWithMeta);
    },

    async recall(runId, fromRound, toRound, pattern) {
      const rows = await Transcript.findAll({
        where: { run_id: runId },
        order: [["round", "ASC"]],
        raw: true,
      });
      const fragments = [];

      for (const row of rows) {
        if (fromRound !== undefined && row.round < fromRound) continue;
        if (toRound !== undefined && row.round > toRound) continue;

        appendFragments(fragments, parseJsonColumn(row.messages));
        appendFragments(fragments, parseJsonColumn(row.folded_payload));
      }

      const selected = pattern === undefined
        ? fragments
        : fragments.filter((fragment) => fragment.includes(pattern));
      return selected.join("\n");
    },

    markRunState,
    saveCheckpoint,

    async appendCheckpoint(runId, checkpoint) {
      await saveCheckpoint(runId, checkpoint);
    },

    loadLatestCheckpoint,

    async sync(options) {
      return Transcript.sync(options);
    },
  };
}
