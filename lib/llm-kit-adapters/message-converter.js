/**
 * Convert legacy messages rows to and from the erix-llm-kit canonical format.
 * This module intentionally has no database dependency.
 */

const META_FIELDS = [
  ["topic_id", "topicId"],
  ["user_id", "userId"],
  ["expert_id", "expertId"],
  ["model_name", "modelName"],
  ["provider_name", "providerName"],
  ["latency_ms", "latencyMs"],
  ["is_deleted", "isDeleted"],
];

function hasValue(value) {
  return value !== null && value !== undefined;
}

function isNonEmpty(value) {
  return hasValue(value) && String(value).length > 0;
}

function parseJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asText(value) {
  if (typeof value === "string") return value;
  if (!hasValue(value)) return "";
  return JSON.stringify(value);
}

function toIsoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  return hasValue(value) ? String(value) : undefined;
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (!hasValue(left)) return -1;
  if (!hasValue(right)) return 1;

  const leftDate = new Date(left).getTime();
  const rightDate = new Date(right).getTime();
  if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate) && leftDate !== rightDate) {
    return leftDate - rightDate;
  }
  return String(left).localeCompare(String(right));
}

function compareRows(left, right) {
  const createdAtOrder = compareValues(left?.created_at, right?.created_at);
  if (createdAtOrder !== 0) return createdAtOrder;
  if (left?.id === right?.id) return 0;
  if (!hasValue(left?.id)) return -1;
  if (!hasValue(right?.id)) return 1;
  return String(left.id).localeCompare(String(right.id));
}

function textBlocksForContent(content) {
  if (!isNonEmpty(content)) return [];
  return [{ type: "text", text: String(content) }];
}

function auxiliaryBlocksForRow(row) {
  const blocks = [];
  if (isNonEmpty(row?.reasoning_content)) {
    blocks.push({
      type: "reasoning",
      text: asText(row.reasoning_content),
    });
  }
  if (isNonEmpty(row?.inner_voice)) {
    blocks.push({
      type: "raw",
      protocol: "touwaka",
      payload: { kind: "inner_voice", text: asText(row.inner_voice) },
    });
  }
  return blocks;
}

function toolUseBlocksForRow(row) {
  const toolCalls = parseJson(row?.tool_calls);
  if (!Array.isArray(toolCalls)) return [];

  return toolCalls.map((toolCall) => {
    const rawArguments = toolCall?.function?.arguments;
    try {
      return {
        type: "tool_use",
        id: toolCall?.id,
        name: toolCall?.function?.name,
        input: JSON.parse(rawArguments === undefined ? "{}" : rawArguments),
      };
    } catch {
      return {
        type: "raw",
        protocol: "openai",
        payload: toolCall,
      };
    }
  });
}

function rowToCanonicalMessage(row) {
  const role = row?.role === "tool" ? "user" : row?.role;
  const content = role === "assistant"
    ? [
      ...textBlocksForContent(row?.content),
      ...toolUseBlocksForRow(row),
      ...auxiliaryBlocksForRow(row),
    ]
    : row?.role === "tool"
      ? [{
        type: "tool_result",
        tool_use_id: row?.tool_call_id,
        content: asText(row?.content),
        ...(hasValue(row?.is_error) ? { is_error: Boolean(row.is_error) } : {}),
      }, ...auxiliaryBlocksForRow(row)]
      : [
        ...textBlocksForContent(row?.content),
        ...auxiliaryBlocksForRow(row),
      ];

  return { role, content };
}

function setIfPresent(target, key, value) {
  if (hasValue(value)) target[key] = value;
}

function mergeRoundMeta(meta, row, isAssistant) {
  for (const [columnName, metaKey] of META_FIELDS.slice(0, 3)) {
    if (hasValue(row?.[columnName])) meta[metaKey] = row[columnName];
  }

  if (!isAssistant) {
    if (!hasValue(meta.errorInfo) && hasValue(row?.error_info)) {
      meta.errorInfo = parseJson(row.error_info);
    }
    if (!hasValue(meta.isDeleted) && hasValue(row?.is_deleted)) {
      meta.isDeleted = row.is_deleted;
    }
    return;
  }

  for (const [columnName, metaKey] of META_FIELDS.slice(3, 6)) {
    if (hasValue(row?.[columnName])) meta[metaKey] = row[columnName];
  }
  if (hasValue(row?.error_info)) meta.errorInfo = parseJson(row.error_info);
  if (hasValue(row?.is_deleted)) meta.isDeleted = row.is_deleted;
  if (hasValue(row?.prompt_tokens)
    && hasValue(row?.completion_tokens)
    && hasValue(row?.cost)) {
    meta.usage = {
      prompt_tokens: row.prompt_tokens,
      completion_tokens: row.completion_tokens,
      cost: row.cost,
    };
  }
}

function createRecord(round, row) {
  const meta = {};
  mergeRoundMeta(meta, row, row?.role === "assistant");
  return {
    round,
    ts: toIsoTimestamp(row?.created_at),
    folded: false,
    messages: [],
    meta,
  };
}

function appendRowToRecord(record, row) {
  mergeRoundMeta(record.meta, row, row?.role === "assistant");
  record.messages.push(rowToCanonicalMessage(row));
}

/**
 * Convert legacy messages rows to a canonical transcript.
 *
 * @param {string} requestId
 * @param {object[]} rows
 * @returns {{runId:string, records:object[]}}
 */
export function legacyRowsToTranscript(requestId, rows) {
  const records = [];
  let currentRecord = null;
  let nextRound = 1;
  let hasAssistant = false;

  const sortedRows = [...(rows ?? [])].sort(compareRows);
  for (const row of sortedRows) {
    if (row?.role === "assistant") {
      currentRecord = createRecord(nextRound, row);
      nextRound += 1;
      hasAssistant = true;
      records.push(currentRecord);
      appendRowToRecord(currentRecord, row);
      continue;
    }

    if (!currentRecord || (!hasAssistant && row?.role === "user" && currentRecord.round !== 0)) {
      currentRecord = createRecord(0, row);
      records.push(currentRecord);
    }

    appendRowToRecord(currentRecord, row);
  }

  return { runId: requestId, records };
}

function blocksForCanonicalContent(content) {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  return Array.isArray(content) ? content : [];
}

function recordBaseFields(record, role) {
  const fields = {};
  const meta = record?.meta ?? {};

  for (const [columnName, metaKey] of META_FIELDS.slice(0, 3)) {
    setIfPresent(fields, columnName, meta[metaKey]);
  }
  if (role === "assistant") {
    for (const [columnName, metaKey] of META_FIELDS.slice(3, 6)) {
      setIfPresent(fields, columnName, meta[metaKey]);
    }
  }
  setIfPresent(fields, "is_deleted", meta.isDeleted);
  setIfPresent(fields, "error_info", meta.errorInfo);
  if (role === "assistant" && meta.usage && typeof meta.usage === "object") {
    for (const key of ["prompt_tokens", "completion_tokens", "cost"]) {
      setIfPresent(fields, key, meta.usage[key]);
    }
  }
  setIfPresent(fields, "created_at", record?.ts);
  return fields;
}

function appendRawFields(row, block) {
  if (block?.type === "reasoning") {
    row.reasoning_content = asText(block.text);
  } else if (block?.protocol === "touwaka" && block.payload?.kind === "reasoning") {
    row.reasoning_content = asText(block.payload.text);
  } else if (block?.protocol === "touwaka" && block.payload?.kind === "inner_voice") {
    row.inner_voice = asText(block.payload.text);
  }
}

function toolCallFromBlock(block) {
  if (block?.type === "tool_use") {
    return {
      id: block.id,
      type: "function",
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      },
    };
  }
  if (block?.type === "raw" && block.protocol === "openai") return block.payload ?? null;
  return null;
}

function assistantMessageToLegacyRows(record, message) {
  const row = {
    role: "assistant",
    content: "",
    ...recordBaseFields(record, "assistant"),
  };
  const toolCalls = [];

  for (const block of blocksForCanonicalContent(message?.content)) {
    if (block?.type === "text") {
      row.content += asText(block.text);
      continue;
    }

    const toolCall = toolCallFromBlock(block);
    if (toolCall !== null) {
      toolCalls.push(toolCall);
      continue;
    }

    appendRawFields(row, block);
  }

  if (toolCalls.length > 0) row.tool_calls = toolCalls;
  return [row];
}

function toolResultToLegacyRow(record, block) {
  const row = {
    role: "tool",
    content: asText(block?.content),
    tool_call_id: block?.tool_use_id,
    ...recordBaseFields(record, "tool"),
  };
  if (hasValue(block?.is_error)) row.is_error = Boolean(block.is_error);
  return row;
}

function userLikeMessageToLegacyRows(record, message, role) {
  const rows = [];
  let text = "";
  let auxiliaryRow = null;
  let emitted = false;

  const flushText = () => {
    if (text.length === 0 && !auxiliaryRow) return;
    rows.push({
      role,
      content: text,
      ...recordBaseFields(record, role),
      ...(auxiliaryRow ?? {}),
    });
    text = "";
    auxiliaryRow = null;
    emitted = true;
  };

  for (const block of blocksForCanonicalContent(message?.content)) {
    if (block?.type === "text") {
      text += asText(block.text);
      continue;
    }
    if (block?.type === "tool_result") {
      flushText();
      rows.push(toolResultToLegacyRow(record, block));
      emitted = true;
      continue;
    }

    const toolCall = toolCallFromBlock(block);
    if (toolCall !== null) {
      auxiliaryRow ??= { tool_calls: [] };
      auxiliaryRow.tool_calls.push(toolCall);
      continue;
    }

    if (block?.type === "raw") {
      auxiliaryRow ??= {};
      appendRawFields(auxiliaryRow, block);
    }
  }

  flushText();
  if (!emitted) {
    rows.push({
      role,
      content: "",
      ...recordBaseFields(record, role),
    });
  }
  if (auxiliaryRow?.tool_calls?.length === 0) {
    delete auxiliaryRow.tool_calls;
  }
  return rows;
}

/**
 * Convert canonical transcript records to legacy-shaped message rows.
 *
 * @param {object[]} records
 * @returns {object[]}
 */
export function canonicalToLegacyMessages(records) {
  const rows = [];
  const sourceRecords = Array.isArray(records) ? records : records?.records ?? [];
  for (const record of sourceRecords) {
    for (const message of record?.messages ?? []) {
      if (message?.role === "assistant") {
        rows.push(...assistantMessageToLegacyRows(record, message));
      } else if (message?.role === "system") {
        rows.push(...userLikeMessageToLegacyRows(record, message, "system"));
      } else {
        rows.push(...userLikeMessageToLegacyRows(record, message, "user"));
      }
    }
  }
  return rows;
}
