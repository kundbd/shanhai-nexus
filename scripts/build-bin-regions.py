"""Build the browser's regional BIN index from a pinned binlist-data snapshot."""

import csv
import re
import sys
from pathlib import Path


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as file:
        yield from csv.DictReader(file)


def build(source, output):
    withheld = {
        row["bin"] for row in rows(source / "conflicts.csv")
        if row["field"] == "alpha_2"
    }
    by_prefix = {}
    for row in rows(source / "bins.csv"):
        prefix, code = row["bin"], row["alpha_2"].strip().upper()
        if not re.fullmatch(r"[0-9]{6}", prefix) or not re.fullmatch(r"[A-Z]{2}", code):
            continue
        if code in {"XX", "ZZ"} or (prefix in withheld and row["source"] != "correction"):
            continue
        if prefix in by_prefix and by_prefix[prefix] != code:
            raise ValueError(f"Conflicting regions for BIN {prefix}")
        by_prefix[prefix] = code

    regions = sorted(set(by_prefix.values()))
    if not 0 < len(regions) <= 255:
        raise ValueError("Unexpected region count")
    ids = {code: index for index, code in enumerate(regions, 1)}
    prefixes = bytearray(1_000_000)
    for prefix, code in by_prefix.items():
        prefixes[int(prefix)] = ids[code]
    output.write_bytes(bytes([len(regions)]) + "".join(regions).encode("ascii") + prefixes)
    print(f"{len(by_prefix)} BINs, {len(regions)} region codes")


if __name__ == "__main__":
    build(*(Path(arg) for arg in sys.argv[1:]))
