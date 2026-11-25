import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readTranscriptTurns } from "./ov-session.mjs";

test("large startup JSONL preserves tool identities, legacy cursors, and a rewritten shorter transcript", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ov-rollout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "rollout.jsonl");
  const response = payload => ({ type: "response_item", payload });
  const records = [
    response({ type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions\n\n<INSTRUCTIONS>\nprior rules\n</INSTRUCTIONS>" }] }),
    { type: "turn_context", payload: {} },
    response({ type: "message", role: "user", content: [{ type: "input_text", text: "Keep this user request intact." }] }),
    response({ type: "function_call_output", call_id: "future", output: "Result before name" }),
    ...Array.from({ length: 130 }, () => ({ type: "compacted", payload: { history: "z".repeat(65536) } })),
    response({ type: "function_call", name: "lookup", call_id: "future", arguments: "{}" }),
    response({ type: "function_call_output", call_id: "future", output: "duplicate output" }),
    { type: "event_msg", payload: { type: "exec_command_end", call_id: "cmd", command: ["one"], aggregated_output: "early result" } },
    { type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", id: "cmd", command: ["two"], status: "completed", stdout: "preferred result" } } },
  ];
  await writeFile(path, records.map(r => JSON.stringify(r)).join("\r\n") + "\ntruncated-line");
  const cfg = { captureAssistantTurns: true };
  const expected = await readTranscriptTurns(path, cfg);
  assert.equal(expected.ok, true);
  assert.ok(expected.turns.length >= 4);
  const stream = skipTurns => readTranscriptTurns(path, cfg, undefined, { streamRecovery: true, skipTurns });
  assert.deepEqual(await stream(0), expected);
  assert.deepEqual((await stream(2)).turns.slice(2), expected.turns.slice(2));
  assert.deepEqual(await stream(expected.turns.length + 1), expected);
  await rm(path);
  assert.equal((await stream(1)).ok, false);
});
