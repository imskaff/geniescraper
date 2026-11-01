// Port of scraper.labels: the Label and Distributor for the Genius form, derived from the ℗ line.
import labelData from "../../data/labels.json";

// Generated from scraper/labels.py by tools/export_labels.py; never edit the JSON by hand.
const LABEL_GROUPS: readonly (readonly [phrase: string, label: string, group: string])[] = labelData as [
  string,
  string,
  string,
][];

const DISTRIBUTED_BY = /\bdistributed\s+by\s+/i;
const NEXT_CONNECTOR =
  /,?\s+(?:under\s+(?:exclusive\s+)?licen[sc]e\s+(?:to|from)|a\s+division\s+of|an?\s+(?:imprint|label)\s+of|released\s+by|marketed\s+by|distributed\s+by)\s+/i;

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

function match(name: string): { label: string; group: string } | null {
  const padded = ` ${normalise(name)} `;
  for (const [phrase, label, group] of LABEL_GROUPS) {
    if (padded.includes(` ${phrase} `)) return { label, group };
  }
  return null;
}

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
  const labels = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const name of names) {
    const hit = match(name);
    if (!hit) continue;
    if (hit.label && !labels.has(hit.label)) labels.set(hit.label, name);
    if (!groups.has(hit.group)) groups.set(hit.group, name);
  }
  const [label = "", labelName = ""] = labels.size === 1 ? ([...labels][0] ?? []) : [];
  const [group = "", groupName = ""] = groups.size === 1 ? ([...groups][0] ?? []) : [];
  const info: LabelInfo = {
    label,
    distributor: group,
    labelSource: label ? `matched “${labelName}” in the ℗ line` : "",
    distributorSource: group ? `owning group of “${groupName}” in the ℗ line` : "",
  };
  const stated = statedDistributor(phonographic.replace(/^[℗©]\s*\d{4}\s*/, "").trim());
  if (stated) {
    info.distributor = match(stated)?.group ?? stated;
    info.distributorSource = "named after “distributed by” in the ℗ line";
  }
  return info;
}
