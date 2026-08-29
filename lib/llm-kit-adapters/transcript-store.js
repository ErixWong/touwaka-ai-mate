import { DataTypes } from "sequelize";

const MODEL_NAME = "llm_kit_transcript";
const TABLE_NAME = "llm_kit_transcripts";

function defineTranscriptModel(sequelize) {
  return sequelize.models[MODEL_NAME] ?? sequelize.define(MODEL_NAME, {
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
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  }, {
    tableName: TABLE_NAME,
    timestamps: false,
    freezeTableName: true,
  });
}

function parseJsonColumn(value) {
  if (typeof value === "string") return JSON.parse(value);
  return value;
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
 * @param {{db: {sequelize: import("sequelize").Sequelize}}} options
 * @returns {{
 *   appendRound: (runId:string, record:object) => Promise<void>,
 *   load: (runId:string) => Promise<object[]>,
 *   recall: (runId:string, fromRound?:number, toRound?:number, pattern?:string) => Promise<string>,
 *   sync: (options?:object) => Promise<object>
 * }}
 */
export function createTouwakaTranscriptStore({ db }) {
  if (!db?.sequelize) throw new Error("[llm-kit-adapters] db 实例必填");

  const Transcript = defineTranscriptModel(db.sequelize);

  return {
    async appendRound(runId, record) {
      await Transcript.create({
        run_id: runId,
        round: record.round,
        ts: record.ts,
        folded: record.folded ?? false,
        messages: record.messages,
        folded_payload: record.foldedPayload ?? null,
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

    async sync(options) {
      return Transcript.sync(options);
    },
  };
}
