"""
Benchmark speed, accuracy and consistency against the golden cases.

    uv run python -m bench.run                      # flow mode, 3 reps, all cases
    uv run python -m bench.run --mode scrape --reps 5
    uv run python -m bench.run --cases sza-sos-t1 rodrigo-sour-t6

Modes:
  flow    what the GUI user waits for: pipeline.detect() then pipeline.fetch_track()
  scrape  apple_music.scrape() alone (pure Apple Music cost)

Metrics per case:
  latency   wall-clock seconds per rep (median and max reported)
  accuracy  F1 over (role, artist) pairs vs golden, averaged over reps
  exact     share of reps with zero differences on title/artist/copyright/cover/credits
  stable    every rep produced the identical result
Plus fail-fast latency for an invalid URL.

Results are printed and saved to bench/results/<utc-timestamp>-<git-sha>.json.
Compare versions by running this in each worktree on the same network.
"""

import argparse
import asyncio
import json
import statistics
import subprocess
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from bench.cases import ROOT, Case, credit_accuracy, diff, load_cases, load_golden
from scraper import apple_music, pipeline
from scraper.models import SongCredits

RESULTS_DIR = ROOT / "bench" / "results"
INVALID_URL = "https://music.apple.com/us/album/does-not-exist/9999999999"


@dataclass
class CaseResult:
    id: str
    latencies: list[float] = field(default_factory=list)
    accuracies: list[float] = field(default_factory=list)
    exact: list[bool] = field(default_factory=list)
    fingerprints: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    last_diff: list[str] = field(default_factory=list)

    @property
    def stable(self) -> bool:
        return not self.errors and len(set(self.fingerprints)) <= 1


async def run_once(case: Case, mode: str) -> SongCredits:
    if mode == "scrape":
        return await apple_music.scrape(case.url, track_index=case.track_index)
    info = await pipeline.detect(case.url)
    titles = info.track_titles
    track_title = titles[case.track_index - 1] if len(titles) >= case.track_index else info.album_title
    return await pipeline.fetch_track(case.url, case.track_index, track_title, info.artist)


def fingerprint(song: SongCredits) -> str:
    return song.model_dump_json(exclude={"youtube_is_mv"})


async def bench_case(case: Case, mode: str, reps: int) -> CaseResult:
    golden = load_golden(case.id)
    result = CaseResult(case.id)
    for _ in range(reps):
        start = time.perf_counter()
        try:
            song = await run_once(case, mode)
        except Exception as exc:
            result.errors.append(f"{type(exc).__name__}: {exc}")
            continue
        result.latencies.append(time.perf_counter() - start)
        problems = diff(song, golden)
        result.accuracies.append(credit_accuracy(song, golden))
        result.exact.append(not problems)
        result.fingerprints.append(fingerprint(song))
        result.last_diff = problems
    return result


async def bench_invalid_url() -> float | None:
    """Seconds until an invalid URL is rejected, or None if it was not detected as invalid."""
    start = time.perf_counter()
    try:
        await apple_music.detect_album(INVALID_URL)
    except apple_music.PageNotFoundError:
        return time.perf_counter() - start
    except Exception:
        return None
    return None


def git_sha() -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True)
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout
        return out.stdout.strip() + ("-dirty" if dirty.strip() else "")
    except OSError:
        return "unknown"


def summarize(results: list[CaseResult], invalid_s: float | None) -> dict:
    lat = [x for r in results for x in r.latencies]
    acc = [x for r in results for x in r.accuracies]
    exact = [x for r in results for x in r.exact]
    return {
        "median_latency_s": round(statistics.median(lat), 2) if lat else None,
        "p90_latency_s": round(statistics.quantiles(lat, n=10)[-1], 2) if len(lat) >= 2 else None,
        "mean_accuracy": round(statistics.fmean(acc), 4) if acc else 0.0,
        "exact_rate": round(sum(exact) / len(exact), 4) if exact else 0.0,
        "stable_cases": sum(r.stable for r in results),
        "total_cases": len(results),
        "errors": sum(len(r.errors) for r in results),
        "invalid_url_s": round(invalid_s, 2) if invalid_s is not None else None,
    }


def print_report(results: list[CaseResult], summary: dict) -> None:
    print(f"\n{'case':<24}{'median s':>9}{'max s':>8}{'acc':>7}{'exact':>7}{'stable':>8}{'err':>5}")
    for r in results:
        med = f"{statistics.median(r.latencies):.1f}" if r.latencies else "-"
        mx = f"{max(r.latencies):.1f}" if r.latencies else "-"
        acc = f"{statistics.fmean(r.accuracies):.2f}" if r.accuracies else "-"
        ex = f"{sum(r.exact)}/{len(r.exact)}"
        print(f"{r.id:<24}{med:>9}{mx:>8}{acc:>7}{ex:>7}{'yes' if r.stable else 'NO':>8}{len(r.errors):>5}")
        for line in r.last_diff:
            print(f"    - {line}")
        for err in dict.fromkeys(r.errors):
            print(f"    ! {err}")
    print("\nsummary:", json.dumps(summary))


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mode", choices=("flow", "scrape"), default="flow")
    parser.add_argument("--reps", type=int, default=3)
    parser.add_argument("--cases", nargs="*", default=[])
    args = parser.parse_args()

    cases = [c for c in load_cases() if not args.cases or c.id in args.cases]
    results: list[CaseResult] = []
    invalid_s: float | None = None
    try:
        for case in cases:
            print(f"{case.id} …", flush=True)
            results.append(await bench_case(case, args.mode, args.reps))
        invalid_s = await bench_invalid_url()
    finally:
        await apple_music.close_browser()

    summary = summarize(results, invalid_s)
    print_report(results, summary)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = RESULTS_DIR / f"{stamp}-{git_sha()}.json"
    payload = {
        "mode": args.mode,
        "reps": args.reps,
        "summary": summary,
        "cases": [asdict(r) | {"stable": r.stable} for r in results],
    }
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"saved {out.relative_to(ROOT)}")


if __name__ == "__main__":
    asyncio.run(main())
