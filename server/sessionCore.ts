import { z } from "zod";

export interface SessionMetadata {
  filename: string;
  timestamp: string;
  durationSeconds: number;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  toolCalls: number;
  messageCount: number;
}

export interface TraceSpan {
  id: string;
  type: "user" | "assistant" | "tool";
  label: string;
  startMs: number;
  endMs: number;
  parentId: string | null;
  depth: number;
}

const contentBlockSchema = z
  .object({
    type: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

function normalizeOptionalTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

function normalizeMessageContent(value: unknown): unknown {
  return Array.isArray(value) ? value : undefined;
}

const messageUsageSchema = z
  .object({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
    cost: z
      .object({
        total: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const messageSchema = z
  .object({
    role: z.string().optional(),
    model: z.string().optional(),
    toolCallId: z.string().optional(),
    usage: messageUsageSchema.optional(),
    content: z.preprocess(
      normalizeMessageContent,
      z.array(contentBlockSchema).optional(),
    ),
  })
  .passthrough();

const sessionEntrySchema = z
  .object({
    type: z.string().optional(),
    timestamp: z.preprocess(
      normalizeOptionalTimestamp,
      z.string().optional(),
    ),
    modelId: z.string().optional(),
    cwd: z.string().optional(),
    message: messageSchema.optional(),
  })
  .passthrough();

type ParsedContentBlock = z.infer<typeof contentBlockSchema>;
type ParsedMessage = z.infer<typeof messageSchema>;
type ParsedSessionEntry = z.infer<typeof sessionEntrySchema>;
type MessageEntry = ParsedSessionEntry & {
  type: "message";
  message: ParsedMessage;
};
type TimedMessageEntry = MessageEntry & { timestamp: string };

function parseSessionEntry(line: string): ParsedSessionEntry | null {
  try {
    const parsed: unknown = JSON.parse(line);
    const result = sessionEntrySchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function parseJsonlLines(content: string): ParsedSessionEntry[] {
  const results: ParsedSessionEntry[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const entry = parseSessionEntry(trimmed);
    if (entry) {
      results.push(entry);
    }
  }

  return results;
}

export function readCwdFromHeader(content: string): string | null {
  const firstNewline = content.indexOf("\n");
  const firstLine =
    firstNewline === -1 ? content : content.slice(0, firstNewline);
  const header = parseSessionEntry(firstLine.trim());

  if (header?.type === "session" && header.cwd) {
    return header.cwd;
  }

  return null;
}

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function isMessageEntry(entry: ParsedSessionEntry): entry is MessageEntry {
  return entry.type === "message" && Boolean(entry.message);
}

function hasTimestamp(entry: MessageEntry): entry is TimedMessageEntry {
  return typeof entry.timestamp === "string" && entry.timestamp.length > 0;
}

function updateTimeRange(
  timestamp: string | undefined,
  current: { first: string | null; last: string | null },
): { first: string | null; last: string | null } {
  if (!timestamp) {
    return current;
  }

  return {
    first: current.first ?? timestamp,
    last: timestamp,
  };
}

function countAssistantToolCalls(
  content: ParsedContentBlock[] | undefined,
): number {
  if (!content) {
    return 0;
  }

  return content.reduce((count, block) => {
    return block.type === "toolCall" ? count + 1 : count;
  }, 0);
}

function collectAssistantUsageTotals(message: ParsedMessage): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  toolCalls: number;
} {
  const usage = message.usage;
  const cost = usage?.cost;

  return {
    inputTokens: usage?.input ?? 0,
    outputTokens: usage?.output ?? 0,
    cacheReadTokens: usage?.cacheRead ?? 0,
    cacheWriteTokens: usage?.cacheWrite ?? 0,
    totalCost: cost?.total ?? 0,
    toolCalls: countAssistantToolCalls(message.content),
  };
}

export function aggregateMetadata(
  entries: ParsedSessionEntry[],
  filename: string,
): SessionMetadata {
  let timeRange = { first: null as string | null, last: null as string | null };
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalCost = 0;
  let toolCalls = 0;
  let messageCount = 0;
  const models = new Set<string>();

  for (const entry of entries) {
    timeRange = updateTimeRange(entry.timestamp, timeRange);

    if (entry.type === "model_change" && entry.modelId) {
      models.add(entry.modelId);
    }

    if (entry.type !== "message") {
      continue;
    }

    messageCount++;
    if (!entry.message || entry.message.role !== "assistant") {
      continue;
    }

    const totals = collectAssistantUsageTotals(entry.message);
    inputTokens += totals.inputTokens;
    outputTokens += totals.outputTokens;
    cacheReadTokens += totals.cacheReadTokens;
    cacheWriteTokens += totals.cacheWriteTokens;
    totalCost += totals.totalCost;
    toolCalls += totals.toolCalls;
  }

  const startTime = timeRange.first ? new Date(timeRange.first).getTime() : 0;
  const endTime = timeRange.last ? new Date(timeRange.last).getTime() : 0;
  const durationSeconds = Math.round((endTime - startTime) / 1000);

  return {
    filename,
    timestamp: timeRange.first || "",
    durationSeconds,
    models: [...models],
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalCost: Math.round(totalCost * 10000) / 10000,
    toolCalls,
    messageCount,
  };
}

function getMessageEntries(entries: ParsedSessionEntry[]): TimedMessageEntry[] {
  return entries.filter(isMessageEntry).filter(hasTimestamp);
}

function getSessionStart(
  entries: ParsedSessionEntry[],
  messages: TimedMessageEntry[],
): number {
  const firstMessageTs = messages[0]?.timestamp;
  if (firstMessageTs) {
    return new Date(firstMessageTs).getTime();
  }

  const firstEntryTs = entries.find((entry) => entry.timestamp)?.timestamp;
  return firstEntryTs ? new Date(firstEntryTs).getTime() : 0;
}

function buildToolResultTimestamps(
  messages: TimedMessageEntry[],
  toMs: (timestamp: string) => number,
): Map<string, number> {
  const timestamps = new Map<string, number>();

  for (const entry of messages) {
    const msg = entry.message;
    if (msg.role === "toolResult" && msg.toolCallId) {
      timestamps.set(msg.toolCallId, toMs(entry.timestamp));
    }
  }

  return timestamps;
}

function createUserSpan(
  messages: TimedMessageEntry[],
  index: number,
  nextSpanId: () => string,
  toMs: (timestamp: string) => number,
): TraceSpan {
  const entry = messages[index];
  const startMs = toMs(entry.timestamp);
  const nextMessage = messages[index + 1];
  const endMs =
    nextMessage?.message.role === "assistant"
      ? toMs(nextMessage.timestamp)
      : startMs;

  return {
    id: nextSpanId(),
    type: "user",
    label: "User",
    startMs,
    endMs: Math.max(endMs, startMs + 1),
    parentId: null,
    depth: 0,
  };
}

function collectAssistantToolSpans(
  message: ParsedMessage,
  assistantSpanId: string,
  assistantStartMs: number,
  toolResultTimestamps: Map<string, number>,
  nextSpanId: () => string,
): { toolSpans: TraceSpan[]; assistantEndMs: number } {
  let assistantEndMs = assistantStartMs;
  const toolSpans: TraceSpan[] = [];

  for (const block of message.content || []) {
    if (!block || block.type !== "toolCall" || !block.id) {
      continue;
    }

    const toolEndMs = toolResultTimestamps.get(block.id) ?? assistantStartMs;
    assistantEndMs = Math.max(assistantEndMs, toolEndMs);
    toolSpans.push({
      id: nextSpanId(),
      type: "tool",
      label: block.name || "tool",
      startMs: assistantStartMs,
      endMs: Math.max(toolEndMs, assistantStartMs + 1),
      parentId: assistantSpanId,
      depth: 1,
    });
  }

  return { toolSpans, assistantEndMs };
}

function consumeToolResponses(
  messages: TimedMessageEntry[],
  startIndex: number,
  currentEndMs: number,
  toMs: (timestamp: string) => number,
): { nextIndex: number; assistantEndMs: number } {
  let nextIndex = startIndex;
  let assistantEndMs = currentEndMs;

  while (nextIndex < messages.length) {
    const role = messages[nextIndex].message.role;
    if (role !== "toolResult" && role !== "bashExecution") {
      break;
    }

    assistantEndMs = Math.max(
      assistantEndMs,
      toMs(messages[nextIndex].timestamp),
    );
    nextIndex++;
  }

  return { nextIndex, assistantEndMs };
}

function createAssistantSpan(
  entry: TimedMessageEntry,
  assistantSpanId: string,
  assistantStartMs: number,
  assistantEndMs: number,
): TraceSpan {
  const label = entry.message.model
    ? `Assistant (${entry.message.model})`
    : "Assistant";

  return {
    id: assistantSpanId,
    type: "assistant",
    label,
    startMs: assistantStartMs,
    endMs: Math.max(assistantEndMs, assistantStartMs + 1),
    parentId: null,
    depth: 0,
  };
}

export function computeSpans(entries: ParsedSessionEntry[]): TraceSpan[] {
  const spans: TraceSpan[] = [];
  const messages = getMessageEntries(entries);
  const sessionStart = getSessionStart(entries, messages);
  const toMs = (timestamp: string) =>
    new Date(timestamp).getTime() - sessionStart;
  const toolResultTimestamps = buildToolResultTimestamps(messages, toMs);

  let spanIdx = 0;
  const nextSpanId = () => `span-${spanIdx++}`;

  let index = 0;
  while (index < messages.length) {
    const entry = messages[index];
    const role = entry.message.role;

    if (role === "user") {
      spans.push(createUserSpan(messages, index, nextSpanId, toMs));
      index++;
      continue;
    }

    if (role !== "assistant") {
      index++;
      continue;
    }

    const assistantStartMs = toMs(entry.timestamp);
    const assistantSpanId = nextSpanId();
    const { toolSpans, assistantEndMs: toolEndMs } = collectAssistantToolSpans(
      entry.message,
      assistantSpanId,
      assistantStartMs,
      toolResultTimestamps,
      nextSpanId,
    );
    const { nextIndex, assistantEndMs } = consumeToolResponses(
      messages,
      index + 1,
      toolEndMs,
      toMs,
    );

    spans.push(
      createAssistantSpan(
        entry,
        assistantSpanId,
        assistantStartMs,
        assistantEndMs,
      ),
    );
    spans.push(...toolSpans);
    index = nextIndex;
  }

  return spans;
}
