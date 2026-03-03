import argparse
import json
from collections import deque
from pathlib import Path
import random

import pandas as pd
from ydata_profiling import ProfileReport


def iter_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                yield value


def sample_jsonl(path: Path, rows: int, mode: str) -> list[dict]:
    if mode == "head":
        result: list[dict] = []
        for item in iter_jsonl(path):
            result.append(item)
            if len(result) >= rows:
                break
        return result

    if mode == "tail":
        buffer: deque = deque(maxlen=rows)
        for item in iter_jsonl(path):
            buffer.append(item)
        return list(buffer)

    # reservoir sample
    reservoir: list[dict] = []
    seen = 0
    for item in iter_jsonl(path):
        seen += 1
        if len(reservoir) < rows:
            reservoir.append(item)
        else:
            idx = random.randint(1, seen)
            if idx <= rows:
                reservoir[idx - 1] = item
    return reservoir


def sample_csv(path: Path, rows: int, mode: str) -> pd.DataFrame:
    if mode == "head":
        return pd.read_csv(path, nrows=rows)

    if mode == "tail":
        chunks = pd.read_csv(path, chunksize=50_000)
        buffer: deque = deque(maxlen=rows)
        for chunk in chunks:
            for _, row in chunk.iterrows():
                buffer.append(row.to_dict())
        return pd.DataFrame(list(buffer))

    # reservoir sample
    reservoir: list[dict] = []
    seen = 0
    chunks = pd.read_csv(path, chunksize=50_000)
    for chunk in chunks:
        for _, row in chunk.iterrows():
            item = row.to_dict()
            seen += 1
            if len(reservoir) < rows:
                reservoir.append(item)
            else:
                idx = random.randint(1, seen)
                if idx <= rows:
                    reservoir[idx - 1] = item
    return pd.DataFrame(reservoir)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--rows", type=int, default=10_000)
    parser.add_argument("--mode", choices=["head", "tail", "sample"], default="sample")
    parser.add_argument("--output", required=True)
    parser.add_argument("--title", default="ML Dataset Profile")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if input_path.suffix == ".jsonl":
        sampled = sample_jsonl(input_path, args.rows, args.mode)
        df = pd.DataFrame(sampled)
    elif input_path.suffix == ".csv":
        df = sample_csv(input_path, args.rows, args.mode)
    else:
        raise SystemExit("Unsupported input format. Use .jsonl or .csv")

    if df.empty:
        raise SystemExit("No rows available for profiling.")

    profile = ProfileReport(df, title=args.title, minimal=True)
    profile.to_file(output_file=str(output_path))
    print(f"Profile report saved: {output_path}")


if __name__ == "__main__":
    main()
