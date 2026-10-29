"""
Compare the two ways of reading album-track credits against the golden files.

    uv run python -m bench.compare                 # 2 reps per path, all cases
    uv run python -m bench.compare --reps 3 --cases sza-sos-t1

  click   album page -> MORE -> View Credits (the original path)
  direct  album page -> the row's own /song/ page

Runs apple_music.scrape() alone (pure Apple Music cost), one scrape at a time, alternating the
two paths within each case so network drift hits both alike.  /song/ URL cases take the same
path either way and serve as a noise baseline.  Results go to bench/results/compare-<utc>.json.
"""

import argparse
import asyncio
import json
import statistics
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from bench.cases import ROOT, Case, credit_accuracy, diff, load_cases, load_golden
from bench.run import RESULTS_DIR
from scraper import apple_music

PATHS = ("click", "direct")
PAUSE_S = 1.0  # between scrapes, to stay polite


@dataclass
class PathResult:
    latencies: list[float] = field(default_factory=list)
    exact: list[bool] = field(default_factory=list)
    accuracies: list[float] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    last_diff: list[str] = field(default_factory=list)


async def compare_case(case: Case, reps: int) -> dict[str, PathResult]:
    golden = load_golden(case.id)
    out = {p: PathResult() for p in PATHS}
    for _ in range(reps):
        for path in PATHS:
            res = out[path]
            start = time.perf_counter()
            try:
                song = await apple_music.scrape(case.url, track_index=case.track_index, direct=path == "direct")
            except Exception as exc:
                res.errors.append(f"{type(exc).__name__}: {exc}")
                continue
            finally:
                await asyncio.sleep(PAUSE_S)
            res.latencies.append(time.perf_counter() - start)
            problems = diff(song, golden)
            res.exact.append(not problems)
            res.accuracies.append(credit_accuracy(song, golden))
            res.last_diff = problems
    return out


def fmt(res: PathResult) -> str:
    if not res.latencies:
        return f"{'-':>8}{'-':>8}  err={len(res.errors)}"
    med = statistics.median(res.latencies)
    return f"{med:>8.2f}{max(res.latencies):>8.2f}  exact {sum(res.exact)}/{len(res.exact)}  err={len(res.errors)}"


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reps", type=int, default=2)
    parser.add_argument("--cases", nargs="*", default=[])
    args = parser.parse_args()

    cases = [c for c in load_cases() if not args.cases or c.id in args.cases]
    results: dict[str, dict[str, PathResult]] = {}
    try:
        for case in cases:
            print(f"{case.id} ...", flush=True)
            results[case.id] = await compare_case(case, args.reps)
    finally:
        await apple_music.close_browser()

    print(f"\n{'case':<24}{'path':<8}{'med s':>8}{'max s':>8}")
    for cid, by_path in results.items():
        for path, res in by_path.items():
            print(f"{cid:<24}{path:<8}{fmt(res)}")
            for line in res.last_diff:
                print(f"    - {line}")
            for err in dict.fromkeys(res.errors):
                print(f"    ! {err}")
    album_ids = [c.id for c in cases if "/album/" in c.url]
    for path in PATHS:
        lat = [x for cid in album_ids for x in results[cid][path].latencies]
        ex = [x for cid in album_ids for x in results[cid][path].exact]
        if lat:
            print(
                f"album cases, {path}: median {statistics.median(lat):.2f}s, "
                f"mean {statistics.fmean(lat):.2f}s, exact {sum(ex)}/{len(ex)}"
            )

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = RESULTS_DIR / f"compare-{stamp}.json"
    payload = {cid: {p: vars(r) for p, r in by.items()} for cid, by in results.items()}
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"saved {out.relative_to(ROOT)}")


if __name__ == "__main__":
    asyncio.run(main())
