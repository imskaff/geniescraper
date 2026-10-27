import { describe, expect, it } from "vitest";
import { autotabSteps, instructionText } from "../../src/core/flow";
import vectors from "../vectors.json";
import { queueFromVector } from "./helpers";

describe("autotabSteps parity with assistant.flow.autotab_steps", () => {
  const cases = vectors.autotab_steps.map((c) => ({ ...c, label: `${c.kind} -> ${String(c.next_kind)}` }));

  it.each(cases)("$label", ({ kind, next_kind, steps }) => {
    expect(autotabSteps(kind, next_kind)).toEqual(steps);
  });

  it("the vectors include non-empty step lists, so the table is not trivially empty", () => {
    expect(vectors.autotab_steps.some((c) => c.steps.length > 0)).toBe(true);
  });
});

describe("instructionText parity with assistant.flow.instruction_text", () => {
  const cases = vectors.instruction_text.map((c) => ({ ...c, label: `pos ${String(c.pos)} hotkey ${c.hotkey}` }));

  it.each(cases)("$label", ({ queue, pos, hotkey, text }) => {
    expect(instructionText(queueFromVector(queue), pos, hotkey)).toBe(text);
  });
});
