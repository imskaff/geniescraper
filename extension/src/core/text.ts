// Small text helpers that reproduce Python string semantics the parsers rely on.

// Line boundaries of Python's str.splitlines() as code points: LF, VT, FF, CR, FS, GS, RS, NEL, LS, PS.
const LINE_BREAKS: ReadonlySet<number> = new Set([0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x85, 0x2028, 0x2029]);

/** Like Python's str.splitlines(): CRLF counts once and a trailing break adds no empty line. */
export function splitLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (!LINE_BREAKS.has(code)) continue;
    lines.push(text.slice(start, i));
    if (code === 0x0d && text.charCodeAt(i + 1) === 0x0a) i++;
    start = i + 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/** Like Python's str.strip(chars): removes any of `chars` from both ends. */
export function stripChars(text: string, chars: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text.charAt(start))) start++;
  while (end > start && chars.includes(text.charAt(end - 1))) end--;
  return text.slice(start, end);
}

/** Like Python's str.rstrip(":") followed by strip(). */
export function trimColon(text: string): string {
  return text.replace(/:+$/, "").trim();
}

/** Length in code points, as Python's len(). */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}
