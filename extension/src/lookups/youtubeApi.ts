// YouTube links through Google's official YouTube Data API, for a user who has entered their own key. It answers in
// the shape the page-reading lookup already scores, so both ways pick a video by the same rules (the golden-tested
// ones in youtube.ts). What the API does not tell us (the verified-channel badges) is simply absent.
// Costs the user's free quota: a search is 100 units of the usual 10,000 a day, a description read is 1.
import type { KeyCheck } from "../shared/messages";
import type { GetResult } from "./http";
import type { YoutubePages } from "./youtube";

const API = "https://www.googleapis.com/youtube/v3";

/** Why the API did not give an answer, in the user's terms. "" means it did, even if there were no results. */
export type ApiProblem = "" | "key" | "quota" | "not-enabled" | "failed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What went wrong, from an error answer's reason codes. */
export function problemOf(status: number, body: unknown): ApiProblem {
  if (status >= 200 && status < 300) return "";
  const error = isRecord(body) ? body["error"] : undefined;
  const list = isRecord(error) && Array.isArray(error["errors"]) ? (error["errors"] as unknown[]) : [];
  const reasons = list.map((e) => (isRecord(e) && typeof e["reason"] === "string" ? e["reason"] : ""));
  const message = isRecord(error) && typeof error["message"] === "string" ? error["message"].toLowerCase() : "";
  if (
    reasons.some((r) =>
      ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(r),
    )
  ) {
    return "quota";
  }
  if (
    reasons.includes("accessNotConfigured") ||
    message.includes("has not been used") ||
    message.includes("is disabled")
  ) {
    return "not-enabled";
  }
  if (
    reasons.some((r) => ["keyInvalid", "badRequest", "forbidden", "ipRefererBlocked", "keyExpired"].includes(r)) ||
    message.includes("api key") ||
    status === 400 ||
    status === 401
  ) {
    return "key";
  }
  return "failed";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The API returns titles with HTML entities in them ("Beyonc&eacute;", "Don&#39;t"). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      const code = Number.parseInt(name.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    if (name.startsWith("#")) {
      const code = Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const run = (text: string) => ({ runs: [{ text }] });

/** A search answer, rewritten as the results page the scorer reads. */
export function searchAsPage(body: unknown): unknown {
  const items = isRecord(body) && Array.isArray(body["items"]) ? (body["items"] as unknown[]) : [];
  const contents: unknown[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = isRecord(item["id"]) ? item["id"]["videoId"] : undefined;
    const snippet = isRecord(item["snippet"]) ? item["snippet"] : {};
    if (typeof id !== "string") continue;
    const title = typeof snippet["title"] === "string" ? decodeEntities(snippet["title"]) : "";
    const channel = typeof snippet["channelTitle"] === "string" ? decodeEntities(snippet["channelTitle"]) : "";
    const description = typeof snippet["description"] === "string" ? decodeEntities(snippet["description"]) : "";
    contents.push({
      videoRenderer: {
        videoId: id,
        title: run(title),
        ownerText: run(channel),
        detailedMetadataSnippets: [{ snippetText: run(description) }],
      },
    });
  }
  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents } }] } },
      },
    },
  };
}

/** A video answer, rewritten as the player response the description reader uses. */
export function videoAsPlayer(body: unknown): unknown {
  const items = isRecord(body) && Array.isArray(body["items"]) ? (body["items"] as unknown[]) : [];
  const first = items[0];
  const snippet = isRecord(first) && isRecord(first["snippet"]) ? first["snippet"] : {};
  const description = typeof snippet["description"] === "string" ? decodeEntities(snippet["description"]) : "";
  return { videoDetails: { shortDescription: description } };
}

export interface ApiPages extends YoutubePages {
  /** The most recent reason the API gave no answer, or "" when its last answer was good. */
  problem(): ApiProblem;
}

/** The two pages the lookup reads, fetched from the API with the user's key in a header (never in the URL). */
export function apiPages(getResult: GetResult, key: string): ApiPages {
  let problem: ApiProblem = "";
  const call = async (path: string, params: Record<string, string>): Promise<unknown> => {
    const url = `${API}/${path}?${new URLSearchParams(params).toString()}`;
    const result = await getResult(url, { "X-Goog-Api-Key": key });
    if (!result) {
      problem = "failed";
      return null;
    }
    const found = problemOf(result.status, result.body);
    if (found) {
      problem = found;
      return null;
    }
    problem = "";
    return result.body;
  };
  return {
    problem: () => problem,
    async search(query) {
      const body = await call("search", { part: "snippet", type: "video", maxResults: "10", q: query });
      return body === null ? null : searchAsPage(body);
    },
    async watch(id) {
      const body = await call("videos", { part: "snippet", id });
      return body === null ? null : videoAsPlayer(body);
    },
  };
}

/** Try a key with the cheapest call there is (1 unit), and say what happened. */
export async function checkKey(getResult: GetResult, key: string): Promise<KeyCheck> {
  const url = `${API}/videos?${new URLSearchParams({ part: "id", id: "dQw4w9WgXcQ" }).toString()}`;
  const result = await getResult(url, { "X-Goog-Api-Key": key });
  if (!result) return "failed";
  return problemOf(result.status, result.body) || "ok";
}
