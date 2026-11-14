#!/usr/bin/env python3
"""Generate and validate the Anne's Witness command plan.

Reads  docs/commands-plan.src.txt
Writes docs/COMMANDS-PLAN.md and docs/commands-plan.json

    python3 scripts/gen-plan.py           # regenerate
    python3 scripts/gen-plan.py --check   # validate; fail if the generated files are out of date

Validation: duplicate ids, malformed ids, unknown origin codes, shortcut conflicts, empty groups,
the presence of the AI tab, and the repository metadata file (AnnesWitness.meta.json).
Uses only the Python standard library (3.10+).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "commands-plan.src.txt"
OUT_MD = ROOT / "docs" / "COMMANDS-PLAN.md"
OUT_JSON = ROOT / "docs" / "commands-plan.json"
META = ROOT / "AnnesWitness.meta.json"

ORIGINS = {
    "NEW": "An Anne's Witness idea",
    "SUITE": "Shared with the other Anne's Office apps (shell, files, AI providers, recovery)",
    "GPS": "Family-history evidence practice (source, information and evidence analysis; written conclusions)",
    "AUD": "Audit working-paper practice (tick marks, tie-out, footing, prepared/reviewed sign-off, roll-forward)",
    "FACT": "Editorial fact-checking practice (checking copy line by line against sources)",
    "TXT": "Textual scholarship (transcription, collation of versions, lines of descent between copies)",
    "LAW": "Exhibit practice (numbered exhibits, sealed copies, redaction)",
    "REF": "Reference managers (citation records and styles)",
    "QDA": "Qualitative research tools (coding passages, matrices)",
    "GENAI": "Generative AI assistants",
}

ID_RE = re.compile(r"^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$")
TOPIC_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,49}$")


def parse(text: str):
    tabs, errors = [], []
    tab = group = None
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or (line.startswith("#") and not line.startswith("##")):
            continue
        if line.startswith("@tab"):
            parts = [p.strip() for p in line[4:].split("|")]
            if len(parts) != 3 or not all(parts):
                errors.append(f"line {n}: @tab needs key | name | description")
                continue
            tab = {"key": parts[0], "name": parts[1], "description": parts[2], "groups": []}
            tabs.append(tab)
            group = None
        elif line.startswith("##"):
            if tab is None:
                errors.append(f"line {n}: group before any @tab")
                continue
            group = {"name": line[2:].strip(), "commands": []}
            tab["groups"].append(group)
        else:
            if group is None:
                errors.append(f"line {n}: command outside a group")
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) != 5:
                errors.append(f"line {n}: expected 5 fields (label | id | shortcut | origins | notes), got {len(parts)}")
                continue
            label, cid, shortcut, origins, notes = parts
            group["commands"].append({
                "id": cid,
                "label": label,
                "shortcut": shortcut,
                "origins": [o for o in origins.split(",") if o],
                "notes": notes,
                "inTabs": "not in tabs" not in notes.lower(),
                "line": n,
            })
    return tabs, errors


def validate(tabs) -> list[str]:
    errors: list[str] = []
    ids: dict[str, int] = {}
    keys: dict[str, str] = {}
    for tab in tabs:
        if not tab["groups"]:
            errors.append(f"tab {tab['name']}: no groups")
        for group in tab["groups"]:
            if not group["commands"]:
                errors.append(f"tab {tab['name']}, group {group['name']}: empty")
            for c in group["commands"]:
                where = f"line {c['line']} ({c['id']})"
                if not ID_RE.match(c["id"]):
                    errors.append(f"{where}: id must look like area.name")
                if c["id"] in ids:
                    errors.append(f"{where}: duplicate id, first on line {ids[c['id']]}")
                ids[c["id"]] = c["line"]
                if not c["label"]:
                    errors.append(f"{where}: empty label")
                if not c["origins"]:
                    errors.append(f"{where}: no origin code")
                for o in c["origins"]:
                    if o not in ORIGINS:
                        errors.append(f"{where}: unknown origin {o}")
                if c["shortcut"]:
                    k = c["shortcut"].lower()
                    if k in keys:
                        errors.append(f"{where}: shortcut {c['shortcut']} already used by {keys[k]}")
                    keys[k] = c["id"]
    ai = [t for t in tabs if t["key"] == "ai"]
    if not ai:
        errors.append("the AI tab is missing")
    else:
        ai_ids = {c["id"] for g in ai[0]["groups"] for c in g["commands"]}
        for needed in ("ai.setup", "ai.privacy", "ai.history", "ai.stop", "ai.ensembleMode"):
            if needed not in ai_ids:
                errors.append(f"AI tab: required command {needed} is missing")
        for g in ai[0]["groups"]:
            for c in g["commands"]:
                if not c["id"].startswith("ai."):
                    errors.append(f"line {c['line']}: command on the AI tab must have an ai. id")
    return errors


def validate_meta() -> list[str]:
    errors: list[str] = []
    try:
        meta = json.loads(META.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return [f"{META.name}: {e}"]
    for field in ("name", "description", "topics", "keywords", "appId", "iconColor"):
        if field not in meta:
            errors.append(f"{META.name}: missing {field}")
    topics = meta.get("topics", [])
    if len(topics) > 20:
        errors.append(f"{META.name}: {len(topics)} topics; GitHub allows 20")
    for t in topics:
        if not TOPIC_RE.match(t):
            errors.append(f"{META.name}: topic {t!r} is not a valid GitHub topic")
    for name in ("topics", "keywords"):
        seq = meta.get(name, [])
        if len(seq) != len(set(seq)):
            errors.append(f"{META.name}: duplicate entries in {name}")
    if len(meta.get("description", "")) > 350:
        errors.append(f"{META.name}: description is over GitHub's 350 characters")
    return errors


def render_md(tabs) -> str:
    total = sum(len(g["commands"]) for t in tabs for g in t["groups"])
    out = [
        "# Command plan",
        "",
        "> **Plan. Generated file:** edit [commands-plan.src.txt](commands-plan.src.txt) and run "
        "`python3 scripts/gen-plan.py`. Anne's Witness has no code yet; this is the inventory the command "
        "registry will be built from. A command is registered in the app only when it works.",
        "",
        f"**{total} commands** on {len(tabs)} tabs. Every command can go on the Quick Access Bar, on a custom "
        "tab, in the classic menu bar, on a keyboard shortcut or in a macro, and is found by command search "
        "(Alt+Q). The classic menu bar has one menu per tab, including an **AI** menu. Shortcuts are planned "
        "defaults and can all be rebound.",
        "",
        "## Origins",
        "",
        "| Code | Meaning |",
        "|---|---|",
    ]
    out += [f"| {k} | {v} |" for k, v in ORIGINS.items()]
    out += ["", "## Tabs", "", "| Tab | Commands | What it is for |", "|---|---|---|"]
    for t in tabs:
        count = sum(len(g["commands"]) for g in t["groups"])
        anchor = t["name"].lower().replace(" ", "-")
        out.append(f"| [{t['name']}](#{anchor}) | {count} | {t['description']} |")
    for t in tabs:
        out += ["", f"## {t['name']}", "", t["description"] + "."]
        for g in t["groups"]:
            out += ["", f"### {g['name']}", "", "| Command | Id | Shortcut | Origins | Notes |", "|---|---|---|---|---|"]
            for c in g["commands"]:
                key = f"`{c['shortcut']}`" if c["shortcut"] else ""
                out.append(f"| {c['label']} | `{c['id']}` | {key} | {', '.join(c['origins'])} | {c['notes']} |")
    return "\n".join(out) + "\n"


def render_json(tabs) -> str:
    data = {
        "app": "Anne's Witness",
        "generatedFrom": "docs/commands-plan.src.txt",
        "origins": ORIGINS,
        "tabs": [
            {
                "key": t["key"],
                "name": t["name"],
                "description": t["description"],
                "groups": [
                    {
                        "name": g["name"],
                        "commands": [{k: v for k, v in c.items() if k != "line"} for c in g["commands"]],
                    }
                    for g in t["groups"]
                ],
            }
            for t in tabs
        ],
    }
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    check = "--check" in sys.argv[1:]
    tabs, errors = parse(SRC.read_text(encoding="utf-8"))
    errors += validate(tabs)
    errors += validate_meta()
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    md, js = render_md(tabs), render_json(tabs)
    total = sum(len(g["commands"]) for t in tabs for g in t["groups"])
    if check:
        stale = [p.name for p, new in ((OUT_MD, md), (OUT_JSON, js))
                 if not p.exists() or p.read_text(encoding="utf-8") != new]
        if stale:
            print("out of date, run python3 scripts/gen-plan.py: " + ", ".join(stale), file=sys.stderr)
            return 1
        print(f"ok: {total} commands on {len(tabs)} tabs; metadata valid")
        return 0
    OUT_MD.write_text(md, encoding="utf-8", newline="\n")
    OUT_JSON.write_text(js, encoding="utf-8", newline="\n")
    print(f"wrote {OUT_MD.name} and {OUT_JSON.name}: {total} commands on {len(tabs)} tabs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
