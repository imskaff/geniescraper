"""
Benchmark the best-effort external lookups against hand-verified truth.

    uv run python -m bench.lookups                  # YouTube and covers, 1 rep
    uv run python -m bench.lookups --only youtube --reps 2
    uv run python -m bench.lookups --cases sza-sos-t1 extra-bts-dynamite

YouTube: youtube.fetch_youtube_url() for every entry in tests/golden/youtube.json.
  correct   the returned video is in the entry's accepted set
  kind_ok   the kind of video (music-video, lyric-video, official-audio, auto-generated) matches the truth
Covers: pipeline.fetch_cover() for every case in bench/cases.json, compared with
the artwork in the case's golden credits file (same artwork, 1000x1000 PNG).

Lookups run one at a time, so the numbers reflect a single user and stay polite.
Results are printed and saved to bench/results/lookups-<utc-timestamp>-<git-sha>.json.
"""

import argparse
import asyncio
import json
import statistics
import time
from datetime import datetime, timezone

from bench.cases import ROOT, artwork_key, load_cases, load_golden
from bench.run import RESULTS_DIR, git_sha
from scraper import pipeline, youtube

YOUTUBE_GOLDEN = ROOT / "tests" / "golden" / "youtube.json"


def load_youtube_golden() -> list[dict]:
    return json.loads(YOUTUBE_GOLDEN.read_text(encoding="utf-8"))


def video_id(url: str) -> str:
    return url.rpartition("v=")[2] if url else ""


def youtube_verdict(entry: dict, url: str, kind: str | None) -> tuple[bool, bool]:
    """(correct video, correct kind) for one lookup result."""
    correct = video_id(url) in entry["accept"]
    return correct, correct and kind == entry["kind"]


def cover_correct(url: str, golden_url: str) -> bool:
    return bool(url) and artwork_key(url) == artwork_key(golden_url) and url.endswith("/1000x1000bb.png")


def _latency_summary(lat: list[float]) -> dict:
    return {
        "median_latency_s": round(statistics.median(lat), 2) if lat else None,
        "p90_latency_s": round(statistics.quantiles(lat, n=10)[-1], 2) if len(lat) >= 2 else None,
        "total_s": round(sum(lat), 1),
    }


async def bench_youtube(entries: list[dict], reps: int) -> tuple[list[dict], dict]:
    rows: list[dict] = []
    for entry in entries:
        print(f"youtube {entry['id']} …", flush=True)
        for _ in range(reps):
            start = time.perf_counter()
            url, kind = await youtube.fetch_youtube_url(entry["title"], entry["artist"])
            elapsed = time.perf_counter() - start
            correct, kind_ok = youtube_verdict(entry, url, kind)
            rows.append(
                {"id": entry["id"], "latency_s": round(elapsed, 2), "got": video_id(url), "kind": kind}
                | {"expected": entry["video_id"], "correct": correct, "kind_ok": kind_ok}
            )
    summary = {
        "accuracy": round(sum(r["correct"] for r in rows) / len(rows), 4) if rows else 0.0,
        "kind_accuracy": round(sum(r["kind_ok"] for r in rows) / len(rows), 4) if rows else 0.0,
        **_latency_summary([r["latency_s"] for r in rows]),
        "runs": len(rows),
    }
    return rows, summary


async def bench_covers(case_ids: list[str], reps: int) -> tuple[list[dict], dict]:
    rows: list[dict] = []
    for case in load_cases():
        if case_ids and case.id not in case_ids:
            continue
        golden = load_golden(case.id)
        print(f"cover {case.id} …", flush=True)
        for _ in range(reps):
            start = time.perf_counter()
            url = await pipeline.fetch_cover(case.url, golden.title, golden.artist)
            elapsed = time.perf_counter() - start
            rows.append(
                {"id": case.id, "latency_s": round(elapsed, 2), "got": url, "expected": golden.cover_art_url}
                | {"correct": cover_correct(url, golden.cover_art_url)}
            )
    summary = {
        "accuracy": round(sum(r["correct"] for r in rows) / len(rows), 4) if rows else 0.0,
        **_latency_summary([r["latency_s"] for r in rows]),
        "runs": len(rows),
    }
    return rows, summary


def print_rows(name: str, rows: list[dict], summary: dict) -> None:
    print(f"\n{name:<30}{'s':>6}  ok  got")
    for r in rows:
        mark = "yes" if r["correct"] and r.get("kind_ok", True) else "NO"
        extra = f" kind={r['kind']}" if "kind" in r else ""
        print(f"{r['id']:<30}{r['latency_s']:>6.1f}  {mark:<4}{r['got'] or '-'}{extra}")
        if mark == "NO":
            print(f"{'':<42}expected {r['expected']}")
    print(f"{name} summary:", json.dumps(summary))


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", choices=("youtube", "covers"), default=None)
    parser.add_argument("--reps", type=int, default=1)
    parser.add_argument("--cases", nargs="*", default=[])
    args = parser.parse_args()

    payload: dict = {"reps": args.reps}
    if args.only in (None, "youtube"):
        entries = [e for e in load_youtube_golden() if not args.cases or e["id"] in args.cases]
        rows, summary = await bench_youtube(entries, args.reps)
        print_rows("youtube", rows, summary)
        payload["youtube"] = {"summary": summary, "runs": rows}
    if args.only in (None, "covers"):
        rows, summary = await bench_covers(args.cases, args.reps)
        print_rows("covers", rows, summary)
        payload["covers"] = {"summary": summary, "runs": rows}

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = RESULTS_DIR / f"lookups-{stamp}-{git_sha()}.json"
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"saved {out.relative_to(ROOT)}")


if __name__ == "__main__":
    asyncio.run(main())
