#!/usr/bin/env python3
"""Fill gaps in a scraped catalog year from Temple's official bulletin PDF.

The 2025-2026 bulletin only exists as an archived PDF, and the Wayback Machine
did not capture every program page. For each program that is missing from
public/data/<year>.json but exists in a neighbouring year:

  1. find the program's pages in the PDF via its table of contents,
  2. pull the requirement tables ("Code Title Credit Hours" ... "Total Credit Hours"),
  3. if the PDF's set of course codes matches the neighbour year's exactly, reuse the
     neighbour's (better-structured) HTML parse, marked "pdf-verified";
     otherwise use a direct parse of the PDF text, marked "pdf".

Usage: scripts/.venv/bin/python scripts/fill_from_pdf.py 2025-2026
"""

import copy
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
PDFS = {
    "2025-2026": ("https://bulletin.temple.edu/archives/Temple_University_Undergraduate_Bulletin_2025-2026_final.pdf",
                  ROOT / "scripts" / ".cache" / "pdf" / "ug-2025-2026.pdf"),
}
COURSE = re.compile(r"^([A-Z]{2,4}) (\d{4})\b")
CODE = re.compile(r"\b([A-Z]{2,4}) (\d{4})\b")
HOURS_TAIL = re.compile(r"\s(\d{1,2}(?:\.\d)?(?:-\d{1,2}(?:\.\d)?)?)$")


def load_pages(year):
    url, pdf = PDFS[year]
    cache = pdf.with_suffix(".pages.json")
    if cache.exists():
        return url, json.loads(cache.read_text())
    import pypdf
    pages = [p.extract_text() or "" for p in pypdf.PdfReader(str(pdf)).pages]
    cache.write_text(json.dumps(pages))
    return url, pages


def page_lines(page):
    out = []
    for ln in page.splitlines():
        ln = ln.strip()
        if re.match(r"^(\d+\s+Temple University Undergraduate Bulletin \d{4}-\d{4}|Schools, Colleges and Divisions\s+\d+)$", ln):
            continue
        if ln:
            out.append(ln)
    return out


def table_of_contents(pages):
    toc = []
    for i in range(1, 60):
        for m in re.finditer(r"^(.+?)\s*\.{4,}\s*(\d+)\s*$", pages[i], re.M):
            toc.append((m.group(1).strip(), int(m.group(2))))
    return toc


def hours(s):
    if not s:
        return None
    a, _, b = s.partition("-")
    return {"min": float(a), "max": float(b or a)}


def parse_tables(lines):
    """Turn PDF course-list lines into blocks shaped like the HTML scraper's output."""
    blocks, i = [], 0
    heading = None
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("Code Title Credit"):
            i += 1
            if i < len(lines) and lines[i] == "Hours":
                i += 1
            sections = [{"title": None, "items": []}]
            group, last, total = None, None, None
            while i < len(lines) and not lines[i].startswith("Total Credit Hours"):
                ln = lines[i]
                if ln.startswith(("•", "Code Title Credit")) or re.match(r"^\d\. [A-Z]", ln) or len(ln) > 140:
                    break  # a table without a total row ends where prose resumes
                i += 1
                m = HOURS_TAIL.search(ln)
                h = hours(m.group(1)) if m else None
                body = ln[:m.start()] if m else ln
                if ln.startswith("& ") and CODE.match(ln[2:]) and last:
                    last["options"][-1]["codes"] += [" ".join(c) for c in re.findall(r"(?:^|& )([A-Z]{2,4}) (\d{4})", ln[2:])]
                    if h and not last["credits"]:
                        last["credits"] = h
                    continue
                if ln.startswith("or ") and CODE.match(ln[3:]):
                    if last:
                        last["options"].append({"codes": [" ".join(CODE.match(ln[3:]).groups())],
                                                "title": CODE.sub("", ln[3:], 1).strip()})
                    continue
                if COURSE.match(ln):
                    codes = [" ".join(COURSE.match(ln).groups())]
                    codes += [" ".join(c) for c in re.findall(r"& ([A-Z]{2,4}) (\d{4})", body)]
                    title = re.sub(r"\s\d$", "", re.sub(r"(?:&\s*)?\b[A-Z]{2,4} \d{4}\b", "", body).strip(" &"))
                    course = {"type": "course", "options": [{"codes": codes, "title": title}], "credits": h}
                    if group is not None and h is None:
                        group["courses"].append(course)
                    else:
                        group = None
                        sections[-1]["items"].append(course)
                    last = course
                    continue
                text = re.sub(r"\s\d$", "", body).strip()
                if h or re.match(r"(select|choose|take|complete)\b", text, re.I):
                    group = {"type": "choose", "text": text, "credits": h,
                             "count": count_of(text), "courses": [], "notes": None}
                    sections[-1]["items"].append(group)
                elif group is not None and not group["courses"] and len(text) < 80 and not text[:1].isupper():
                    group["text"] += " " + text  # wrapped comment line
                else:
                    group = None
                    sections.append({"title": text, "items": []})
                last = None
            if i < len(lines) and lines[i].startswith("Total Credit Hours"):
                total = hours(HOURS_TAIL.search(lines[i]).group(1)) if HOURS_TAIL.search(lines[i]) else None
            for sec in sections:
                for it in sec["items"]:
                    if it["type"] == "choose" and not it["courses"]:
                        it["type"] = "rule"
                        it.pop("courses")
                        it["rule"] = rule_of(it["text"])
            sections = [s for s in sections if s["items"]]
            if sections:
                hd = (heading or "").lower()
                role = "info" if re.search(r"writing[- ]intensive", hd) else \
                    "concentration" if re.search(r"concentration|track|option|specialization", hd) else "core"
                blocks.append({"heading": heading, "total": total, "role": role, "sections": sections})
            if i < len(lines) and not lines[i].startswith("Total Credit Hours"):
                continue
        else:
            if len(ln) < 120 and not COURSE.match(ln) and not ln.endswith("."):
                heading = ln
        i += 1
    if any(b["total"] for b in blocks):
        for b in blocks:
            if b["role"] == "core" and not b["total"]:
                b["role"] = "info"
    return blocks


WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}


def count_of(text):
    m = re.search(r"\b(?:select|choose|take|complete)\s+(\d+|one|two|three|four|five|six)\b(?!\s*credit)", text, re.I)
    if not m:
        return None
    v = m.group(1).lower()
    return int(v) if v.isdigit() else WORDS[v]


def rule_of(text):
    m = re.search(r"(\d{4})\s*(?:-|to|through)\s*(\d{4})", text)
    if m:
        return {"levels": [int(m.group(1)), int(m.group(2))]}
    if re.search(r"upper[- ]level", text, re.I):
        return {"levels": [2000, 4999]}
    return None


def code_set(blocks):
    out = set()
    for b in blocks:
        if b["role"] == "info":
            continue
        for s in b["sections"]:
            for it in s["items"]:
                for c in ([it] if it["type"] == "course" else it.get("courses", [])):
                    for o in c["options"]:
                        out.update(o["codes"])
    return out


def main(year):
    url, pages = load_pages(year)
    toc = table_of_contents(pages)
    starts = sorted(p for _, p in toc)
    title_page = {t: p for t, p in toc}

    target = json.loads((DATA / f"{year}.json").read_text())
    have = {p["id"] for p in target["programs"]}
    y0 = int(year[:4])
    neighbours = {}
    for ny in (f"{y0 - 1}-{y0}", f"{y0 + 1}-{y0 + 2}"):
        f = DATA / f"{ny}.json"
        if f.exists():
            for p in json.loads(f.read_text())["programs"]:
                neighbours.setdefault(p["id"], []).append(p)

    added, verified, parsed, absent = [], 0, 0, []
    for pid, cands in sorted(neighbours.items()):
        if pid in have:
            continue
        name = cands[0]["name"]
        if name not in title_page:
            absent.append(pid)
            continue
        start = title_page[name]
        end = next((p for p in starts if p > start), start + 6)
        lines = []
        for pg in range(start, min(end + 1, len(pages))):
            lines += page_lines(pages[pg])
        try:
            lines = lines[lines.index(name):]
        except ValueError:
            pass
        # stop at the suggested academic plan (repeats courses by semester) or the next program
        for stop in ("Suggested Academic Plan", "Academic Plan"):
            if stop in lines[1:]:
                lines = lines[:lines.index(stop, 1)]
                break
        blocks = parse_tables(lines)
        pdf_codes = code_set(blocks)
        if not pdf_codes:
            absent.append(pid)
            continue
        match = next((c for c in cands if code_set(c["blocks"]) == pdf_codes), None)
        if match:
            prog = copy.deepcopy(match)
            prog["sourceKind"] = "pdf-verified"
            verified += 1
        else:
            prog = copy.deepcopy(cands[0])
            prog["blocks"] = blocks
            prog["majorCredits"] = None
            totals = [b["total"] for b in blocks if b["role"] == "core" and b["total"]]
            if totals:
                prog["majorCredits"] = {"min": sum(t["min"] for t in totals), "max": sum(t["max"] for t in totals)}
            prog["sourceKind"] = "pdf"
            prog["notes"] = []
            prog["footnotes"] = []
            parsed += 1
        prog.update({"year": year, "statedYear": year, "source": f"{url}#page={start + 1}",
                     "url": f"{url}#page={start + 1}"})
        added.append(prog)

    target["programs"] += added
    target["programs"].sort(key=lambda p: (p["degree"] == "Minor", p["name"]))
    (DATA / f"{year}.json").write_text(json.dumps(target, separators=(",", ":")))
    idx = json.loads((DATA / "index.json").read_text())
    P = target["programs"]
    idx["years"][year].update({"count": len(P), "majors": sum(p["degree"] != "Minor" for p in P),
                               "minors": sum(p["degree"] == "Minor" for p in P), "source": "wayback+pdf"})
    (DATA / "index.json").write_text(json.dumps(idx, indent=2))
    print(f"added {len(added)} ({verified} pdf-verified against a neighbour year, {parsed} parsed from pdf)")
    if absent:
        print(f"not in the {year} pdf (likely not offered that year): {', '.join(absent)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "2025-2026")
