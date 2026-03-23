import { describe, expect, it } from "vitest";
import {
  aggregateMetadata,
  computeSpans,
  parseJsonlLines,
  readCwdFromHeader,
} from "../../server/sessionCore";
import { sanitizeParam } from "../../server/sessions";

describe("server/sessions", () => {
  it("rejects unsafe path params", () => {
    expect(sanitizeParam("project-name")).toBe("project-name");
    expect(sanitizeParam("../escape")).toBeNull();
    expect(sanitizeParam("nested/path")).toBeNull();
    expect(sanitizeParam("nested\\path")).toBeNull();
  });

  it("parses JSONL lines and skips malformed entries", () => {
    const content = [
      '{"type":"session","cwd":"/tmp/demo"}',
      "",
      '{"type":"message","timestamp":"2024-01-01T00:00:00.000Z"}',
      "not-json",
    ].join("\n");

    expect(parseJsonlLines(content)).toEqual([
      { type: "session", cwd: "/tmp/demo" },
      { type: "message", timestamp: "2024-01-01T00:00:00.000Z" },
    ]);
  });

  it("preserves message entries with legacy string content", () => {
    const content = [
      '{"type":"message","timestamp":"2024-01-01T00:00:00.000Z","message":{"role":"user","content":"hello"}}',
    ].join("\n");

    expect(parseJsonlLines(content)).toEqual([
      {
        type: "message",
        timestamp: "2024-01-01T00:00:00.000Z",
        message: { role: "user" },
      },
    ]);
  });

  it("drops invalid timestamps during parsing instead of dropping entries", () => {
    const content = [
      '{"type":"message","timestamp":"not-a-date","message":{"role":"assistant","content":[]}}',
    ].join("\n");

    expect(parseJsonlLines(content)).toEqual([
      {
        type: "message",
        message: { role: "assistant", content: [] },
      },
    ]);
  });

  it("reads cwd from the session header", () => {
    const content = [
      '{"type":"session","cwd":"/Users/test/project"}',
      '{"type":"message","timestamp":"2024-01-01T00:00:00.000Z"}',
    ].join("\n");

    expect(readCwdFromHeader(content)).toBe("/Users/test/project");
  });

  it("aggregates metadata from assistant usage and tool calls", () => {
    const entries = [
      {
        type: "model_change",
        timestamp: "2024-01-01T00:00:00.000Z",
        modelId: "gpt-4.1",
      },
      {
        type: "message",
        timestamp: "2024-01-01T00:00:01.000Z",
        message: { role: "user", content: [] },
      },
      {
        type: "message",
        timestamp: "2024-01-01T00:00:03.000Z",
        message: {
          role: "assistant",
          usage: {
            input: 10,
            output: 5,
            cacheRead: 2,
            cacheWrite: 1,
            cost: { total: 0.12345 },
          },
          content: [
            { type: "toolCall", id: "tool-1", name: "bash" },
            { type: "text", text: "hello" },
          ],
        },
      },
      {
        type: "message",
        timestamp: "2024-01-01T00:00:04.000Z",
        message: { role: "toolResult", toolCallId: "tool-1", content: [] },
      },
    ];

    expect(aggregateMetadata(entries, "session.jsonl")).toEqual({
      filename: "session.jsonl",
      timestamp: "2024-01-01T00:00:00.000Z",
      durationSeconds: 4,
      models: ["gpt-4.1"],
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      totalCost: 0.1235,
      toolCalls: 1,
      messageCount: 3,
    });
  });

  it("counts legacy string-content messages in metadata", () => {
    const entries = parseJsonlLines([
      '{"type":"message","timestamp":"2024-01-01T00:00:00.000Z","message":{"role":"user","content":"hello"}}',
      '{"type":"message","timestamp":"2024-01-01T00:00:01.000Z","message":{"role":"assistant","content":"world"}}',
    ].join("\n"));

    expect(aggregateMetadata(entries, "session.jsonl")).toEqual({
      filename: "session.jsonl",
      timestamp: "2024-01-01T00:00:00.000Z",
      durationSeconds: 1,
      models: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCost: 0,
      toolCalls: 0,
      messageCount: 2,
    });
  });

  it("computes user, assistant, and tool spans", () => {
    const entries = [
      {
        type: "message",
        timestamp: "2024-01-01T00:00:00.000Z",
        message: { role: "user", content: [] },
      },
      {
        type: "message",
        timestamp: "2024-01-01T00:00:02.000Z",
        message: {
          role: "assistant",
          model: "gpt-4.1",
          content: [{ type: "toolCall", id: "tool-1", name: "bash" }],
        },
      },
      {
        type: "message",
        timestamp: "2024-01-01T00:00:03.000Z",
        message: { role: "toolResult", toolCallId: "tool-1", content: [] },
      },
      {
        type: "message",
        timestamp: "2024-01-01T00:00:04.000Z",
        message: { role: "assistant", model: "gpt-4.1", content: [] },
      },
    ];

    expect(computeSpans(entries)).toEqual([
      {
        id: "span-0",
        type: "user",
        label: "User",
        startMs: 0,
        endMs: 2000,
        parentId: null,
        depth: 0,
      },
      {
        id: "span-1",
        type: "assistant",
        label: "Assistant (gpt-4.1)",
        startMs: 2000,
        endMs: 3000,
        parentId: null,
        depth: 0,
      },
      {
        id: "span-2",
        type: "tool",
        label: "bash",
        startMs: 2000,
        endMs: 3000,
        parentId: "span-1",
        depth: 1,
      },
      {
        id: "span-3",
        type: "assistant",
        label: "Assistant (gpt-4.1)",
        startMs: 4000,
        endMs: 4001,
        parentId: null,
        depth: 0,
      },
    ]);
  });

  it("ignores message entries without valid timestamps when computing spans", () => {
    const entries = parseJsonlLines([
      '{"type":"message","timestamp":"not-a-date","message":{"role":"user","content":[]}}',
      '{"type":"message","message":{"role":"user","content":[]}}',
      '{"type":"message","timestamp":"2024-01-01T00:00:02.000Z","message":{"role":"assistant","model":"gpt-4.1","content":[]}}',
    ].join("\n"));

    expect(computeSpans(entries)).toEqual([
      {
        id: "span-0",
        type: "assistant",
        label: "Assistant (gpt-4.1)",
        startMs: 0,
        endMs: 1,
        parentId: null,
        depth: 0,
      },
    ]);
  });
});
