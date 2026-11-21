"""Build the browser BIN details index from the pinned sources in NOTICE.txt."""

import csv
import json
import struct
import sys
import unicodedata
from array import array
from pathlib import Path

FIELDS = ("issuer", "brand", "type")
TYPES = {"CREDIT", "DEBIT", "PREPAID", "CHARGE CARD", "QUASI-CREDIT"}
BRANDS = {
    "CHINA UNION PAY": "UNIONPAY",
    "CHINA UNIONPAY": "UNIONPAY",
    "UNION PAY": "UNIONPAY",
    "MASTER CARD": "MASTERCARD",
    "AMEX": "AMERICAN EXPRESS",
}


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as file:
        yield from csv.DictReader(file)


def clean(field, value):
    value = " ".join(value.split())
    if not value or value.upper() in {"UNKNOWN", "UNDEFINED", "N/A", "NONE", "OTHER", "NULL", "-"}:
        return ""
    if field == "type" and value not in TYPES:
        return ""
    if field == "brand":
        return BRANDS.get(value.upper(), value.upper())
    return value


def equivalent(field, first, second):
    first, second = clean(field, first), clean(field, second)
    if field != "issuer":
        return first == second

    def issuer_key(value):
        return "".join(char for char in unicodedata.normalize("NFKC", value).casefold() if char.isalnum())

    return issuer_key(first) == issuer_key(second)


def build(source, mainland_details, output):
    regions = Path("public/bin-data/issuer-regions-fcc907c.bin").read_bytes()
    supplement = json.loads(Path("content/bin-mainland-prefixes.json").read_text(encoding="utf-8"))
    mainland = json.loads(mainland_details.read_text(encoding="utf-8"))
    offset = 1 + regions[0] * 2
    countries = [b""] + [regions[i:i + 2] for i in range(1, offset, 2)]
    records = {
        f"{number:06d}": (countries[index].decode("ascii"), "", "", "")
        for number, index in enumerate(regions[offset:]) if index
    }
    conflicts = {
        (row["bin"], row["field"]) for row in rows(source / "conflicts.csv")
        if row["field"] in FIELDS and not equivalent(row["field"], row["iannuttall"], row["venelinkochev"])
    }
    seen = set()
    for row in rows(source / "bins.csv"):
        prefix, country = row["bin"], row["alpha_2"].strip().upper()
        if prefix not in records or records[prefix][0] != country:
            continue
        info = (
            clean(field, row[field]) if row["source"] == "correction" or (prefix, field) not in conflicts else ""
            for field in FIELDS
        )
        records[prefix] = (country, *info)
        seen.add(prefix)
    if len(seen) != len(records):
        raise ValueError("The BIN source does not reproduce the published region index")
    for prefix in supplement:
        if records.get(prefix, ("",))[0] != "CN":
            records[prefix] = ("CN", "", "", "")
    for prefix, details in mainland.items():
        if records.get(prefix, ("",))[0] == "CN":
            records[prefix] = (
                "CN",
                *(clean(field, details.get(field, "")) or recorded
                  for field, recorded in zip(FIELDS, records[prefix][1:])),
            )

    dictionary = [None]
    ids = {}
    index = array("H", [0]) * 1_000_000
    exact = {}
    for prefix, card in sorted(records.items()):
        if card not in ids:
            ids[card] = len(dictionary)
            dictionary.append(card)
        if len(prefix) == 8:
            exact[prefix] = ids[card]
        else:
            index[int(prefix)] = ids[card]
    if sys.byteorder != "little":
        index.byteswap()
    metadata = json.dumps([dictionary, exact], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    output.write_bytes(struct.pack("<I", len(metadata)) + metadata + index.tobytes())
    print(f"{len(records)} BINs, {len(exact)} exact eight-digit BINs, {len(dictionary) - 1} distinct card records")
    print("Known fields:", {field: sum(bool(card[i]) for card in records.values()) for i, field in enumerate(FIELDS, 1)})


if __name__ == "__main__":
    build(*(Path(arg) for arg in sys.argv[1:]))
