// Port of scraper.labels: the Label and Distributor for the Genius form, derived from the ℗ line.
import labelData from "../../data/labels.json";

// Generated from scraper/labels.py by tools/export_labels.py; never edit the JSON by hand.
const LABEL_GROUPS: readonly (readonly [phrase: string, label: string, group: string])[] = labelData as [
  string,
  string,
  string,
][];

const DISTRIBUTED_BY = /\bdistributed\s+(?:by|through)\s+/i;
const NEXT_CONNECTOR =
  /,?\s+(?:under\s+(?:exclusive\s+)?licen[sc]e\s+(?:to|from)|a\s+division\s+of|an?\s+(?:imprint|label)\s+of|released\s+by|marketed\s+by|distributed\s+(?:by|through))\s+/i;

export interface LabelInfo {
  label: string;
  distributor: string;
  /** Where each value came from, in words for the review screen; "" when the value is empty. */
  labelSource: string;
  distributorSource: string;
}

const normalise = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const MAJORS = new Set(["Sony Music Entertainment", "Universal Music Group", "Warner Music Group"]);

// Mirrors the "marketed by" and "a division of" connectors in scraper.labels: what follows is a parent or marketer.
const SECONDARY = String.raw`(?:marketed\s+(?:and\s+distributed\s+)?by|released\s+by|(?:a|an)\s+(?:division|imprint|label)\s+of)\s+`;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** Every distinct label and group the name contains: "Mercury Records/Republic Records" names two labels. */
function matches(name: string): { label: string; group: string }[] {
  const padded = ` ${normalise(name)} `;
  const found: { label: string; group: string }[] = [];
  for (const [phrase, label, group] of LABEL_GROUPS) {
    if (padded.includes(` ${phrase} `) && !found.some((hit) => hit.label === label && hit.group === group)) {
      found.push({ label, group });
    }
  }
  return found;
}

/** True for a name that follows "distributed by" or "distributed through": it distributes, it is not the label. */
const isDistributor = (line: string, name: string): boolean =>
  new RegExp(DISTRIBUTED_BY.source + escapeRegExp(name), "i").test(line);

/** True for a name that follows "marketed by" or "a division of": the marketer or parent, not the label itself. */
const isSecondary = (line: string, name: string): boolean => new RegExp(SECONDARY + escapeRegExp(name), "i").test(line);

function statedDistributor(line: string): string {
  const found = DISTRIBUTED_BY.exec(line);
  if (!found) return "";
  const rest = line.slice(found.index + found[0].length);
  return (rest.split(NEXT_CONNECTOR)[0] ?? "")
    .trim()
    .replace(/^,+|,+$/g, "")
    .trim();
}

/** `names` are the labels of the ℗ line (extractLabels). Empty values when the evidence is not clear. */
export function deriveLabelInfo(phonographic: string, names: readonly string[]): LabelInfo {
  const none: LabelInfo = { label: "", distributor: "", labelSource: "", distributorSource: "" };
  if (!phonographic || names.length === 0) return none;
  const labels = new Map<string, { name: string; group: string; secondary: boolean }>();
  const groups = new Map<string, string>();
  // "X, distributed through Y" arrives as one name: X can be the label, Y only distributes.
  const parts: [name: string, distributing: boolean][] = [];
  for (const name of names) {
    const found = DISTRIBUTED_BY.exec(name);
    if (found) {
      parts.push(
        [name.slice(0, found.index).replace(/^[ ,]+|[ ,]+$/g, ""), false],
        [name.slice(found.index + found[0].length), true],
      );
    } else {
      parts.push([name, isDistributor(phonographic, name)]);
    }
  }
  for (const [name, distributing] of parts) {
    const secondary = isSecondary(phonographic, name);
    for (const { label, group } of matches(name)) {
      if (label && !distributing && !labels.has(label)) labels.set(label, { name, group, secondary });
      if (group && !groups.has(group)) groups.set(group, name);
    }
  }
  // A marketer or parent of the same group as a primary label (Rhino for Atlantic, Atlantic UK for Asylum) is not
  // a second candidate; across groups the line stays ambiguous.
  const primaryGroups = new Set([...labels.values()].filter((v) => !v.secondary).map((v) => v.group));
  const candidates = [...labels].filter(([, v]) => !(v.secondary && primaryGroups.has(v.group)));
  const [label = "", found] = candidates.length === 1 ? (candidates[0] ?? []) : [];
  const [group = "", groupName = ""] = groups.size === 1 ? ([...groups][0] ?? []) : [];
  const info: LabelInfo = {
    label,
    distributor: group,
    labelSource: label && found ? `matched “${found.name}” in the ℗ line` : "",
    distributorSource: group
      ? `${MAJORS.has(group) ? "owning group of" : "distributor"} “${groupName}” in the ℗ line`
      : "",
  };
  const stated = statedDistributor(phonographic.replace(/^[℗©]\s*\d{4}\s*/, "").trim());
  if (stated) {
    info.distributor = matches(stated)[0]?.group || stated;
    info.distributorSource = "named after “distributed by” in the ℗ line";
  }
  return info;
}
