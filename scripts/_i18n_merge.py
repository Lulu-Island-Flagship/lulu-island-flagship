#!/usr/bin/env python3
"""
Merge per-locale translation fragments into messages/{en,fr,zh}.json under a given
dotted path (e.g. "admin.contingencia"). Usage: define FRAGMENTS below and run.
Deep-merges (does not clobber sibling keys), then rewrites the file with the same
2-space indent + trailing newline convention as the existing files.
"""
import json
import sys

LOCALE_FILES = {
    "en": "messages/en.json",
    "fr": "messages/fr.json",
    "zh": "messages/zh.json",
}


def deep_set(d, dotted_path, value):
    parts = dotted_path.split(".")
    cur = d
    for p in parts[:-1]:
        cur = cur.setdefault(p, {})
    cur[parts[-1]] = value


def merge(dotted_path, fragments):
    """fragments: dict of locale -> value (dict/str) to place at dotted_path."""
    for locale, value in fragments.items():
        path = LOCALE_FILES[locale]
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        deep_set(data, dotted_path, value)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
    print(f"merged {dotted_path} into {list(fragments.keys())}")


if __name__ == "__main__":
    # Import and run the fragment module passed as argv[1]
    mod_path = sys.argv[1]
    ns = {}
    with open(mod_path, "r", encoding="utf-8") as f:
        code = f.read()
    exec(compile(code, mod_path, "exec"), ns)
    merge(ns["PATH"], ns["FRAGMENTS"])
