import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript build helper, with no type declarations
import { frame, unframe } from "../scripts/lib/marionette.mjs";

declare function frame(message: unknown): string;
declare function unframe(buffer: Buffer): { packets: unknown[]; rest: Buffer };

describe("Marionette framing", () => {
  it("prefixes the byte length, counting multi-byte characters as bytes", () => {
    expect(frame([0, 1, "x", {}])).toBe('12:[0,1,"x",{}]');
    expect(frame(["é"])).toBe('6:["é"]');
  });

  it("reads several packets and keeps a partial one for later", () => {
    const first = Buffer.from(frame({ a: 1 }) + frame([1, 2, null, "é"]));
    const half = Buffer.from(frame({ long: "text" }).slice(0, 8));
    const { packets, rest } = unframe(Buffer.concat([first, half]));
    expect(packets).toEqual([{ a: 1 }, [1, 2, null, "é"]]);
    expect(rest.toString()).toBe(half.toString());
    const done = unframe(Buffer.concat([rest, Buffer.from(frame({ long: "text" }).slice(8))]));
    expect(done.packets).toEqual([{ long: "text" }]);
  });
});
