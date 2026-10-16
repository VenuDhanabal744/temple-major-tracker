#!/usr/bin/env python3
"""Scrape Temple's General Education (GenEd) requirements for each catalog year.

Reads /undergraduate/general-education/ (area framework and course-sequence waivers) and
each area page (/ga/, /gb/, ... /gy-gz/) for its approved course list, from the same
per-year sources as scrape_bulletin.py. 2025-2026 comes from Internet Archive snapshots;
every area's course list is checked against the official 2025-2026 bulletin PDF, and the
PDF's list is used when the archive has no matching snapshot.

Output: public/data/gened/<year>.json, shaped like a program (blocks > sections > items)
so src/lib/audit.ts can audit it.

Usage:  scripts/.venv/bin/python scripts/scrape_gened.py [--years 2026-2027,...] [--refresh]
"""

import argparse
import itertools
import json
import re
import sys
import time
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scrape_bulletin import COURSE_RE, OUT, YEARS, clean, fetch  # noqa: E402

GENED_OUT = OUT / "gened"
PDF_PAGES = {"2025-2026": Path(__file__).resolve().parent / ".cache" / "pdf" / "ug-2025-2026.pages.json"}
PDF_URL = {"2025-2026": "https://bulletin.temple.edu/archives/Temple_University_Undergraduate_Bulletin_2025-2026_final.pdf"}

# area code -> (area page slug, heading of its course list)
AREA_PAGES = {
    "GW": ("gw", "Analytical Reading & Writing Courses"),
    "GQ": ("gq", "Quantitative Literacy Courses"),
    "GY": ("gy-gz", "Intellectual Heritage Courses"),
    "GZ": ("gy-gz", "Intellectual Heritage Courses"),
    "GA": ("ga", "Arts Courses"),
    "GB": ("gb", "Human Behavior Courses"),
    "GD": ("gd", "Race & Diversity Courses"),
    "GG": ("gg", "Global/World Society Courses"),
    "GS": ("gs", "Science & Technology Courses"),
    "GU": ("gu", "U.S. Society Courses"),
}
FOUNDATION = ["GW", "GQ", "GY", "GZ"]
NUMWORDS = {"one": 1, "two": 2, "three": 3}


def codes_of(text):
    return [f"{a} {b}" for a, b in COURSE_RE.findall(text.replace("\xa0", " "))]


def gened_codes(text):
    """GenEd course numbers begin with 08XX (09XX for honors); area pages also repeat waiver
    courses, which come from the main page instead."""
    return [c for c in codes_of(text) if c.split()[1][:2] in ("08", "09")]


def wayback_snapshots(cfg, path):
    """Archive timestamps for a bulletin path inside the year's window, newest first. GenEd pages
    carry no "matriculated in" banner, so stop before July, when the next bulletin goes live."""
    to = min(cfg["to"], f"{cfg['to'][:4]}0630")
    url = (f"https://web.archive.org/cdx/search/cdx?url=bulletin.temple.edu/undergraduate/{path}"
           f"&from={cfg['from']}&to={to}&filter=statuscode:200&fl=timestamp")
    text = fetch(url) or ""
    return sorted({ln.strip() for ln in text.splitlines() if ln.strip()}, reverse=True)


def page_urls(year, path):
    """Candidate (fetch url, canonical url, sourceKind) for a GenEd page of this year."""
    cfg = YEARS[year]
    canonical = f"{cfg['base']}/{path}"
    if cfg["kind"] == "live":
        return [(canonical, canonical, "live")]
    return [(f"https://web.archive.org/web/{ts}id_/{canonical}", canonical, "wayback")
            for ts in wayback_snapshots(cfg, path)]


# ---------------------------------------------------------------- main page

def parse_framework(tc):
    """The two "Program Framework" tables: attribute, area name, '1 course, 4 credit hours'."""
    areas = {}
    for tr in tc.select("table.tbl_programframework tbody tr"):
        tds = [clean(td.get_text(" ")) for td in tr.find_all("td")]
        if len(tds) < 3:
            continue
        code, name, req = tds[:3]
        m = re.match(r"(\d+|one|two|three)\s+courses?", req, re.I)
        count = int(m.group(1)) if m and m.group(1).isdigit() else NUMWORDS.get((m.group(1) if m else "one").lower(), 1)
        hrs = [int(h) for h in re.findall(r"\b(\d)\b", req.split(",", 1)[-1])]
        each = "each" in req
        lo, hi = (min(hrs), max(hrs)) if hrs else (3, 3)
        if each:
            lo, hi = lo * count, hi * count
        areas[code] = {"code": code, "name": name, "requirement": req, "count": count,
                       "credits": {"min": lo, "max": hi}}
    return areas


def sequence_options(text):
    """'A, B or C, and D' -> every all-of combination: [[A,B,D],[A,C,D]]. Codes joined by
    'or' are alternatives for one slot; anything else starts a new slot."""
    text = text.replace("\xa0", " ")
    ms = list(COURSE_RE.finditer(text))
    slots = []
    for i, m in enumerate(ms):
        code = f"{m.group(1)} {m.group(2)}"
        between = text[ms[i - 1].end():m.start()] if i else None
        if between is not None and re.fullmatch(r"\s*,?\s*or\s*", between):
            slots[-1].append(code)
        else:
            slots.append([code])
    return [list(c) for c in itertools.islice(itertools.product(*slots), 32)]


def parse_waivers(tc):
    """Course-based waivers per area from the 'General Education Waivers' section.

    Returns {area: {"options": [CourseItem], "lists": [ListItem], "notes": [str]}}."""
    start = next((h for h in tc.find_all("h2") if "waiver" in h.get_text().lower()), None)
    out = {}
    if start is None:
        return out
    area, school, context, list_name = None, None, None, None
    for el in start.find_all_next(["h2", "h3", "h4", "p", "li"]):
        if el.name == "h2":
            break
        text = clean(el.get_text(" "))
        if el.name == "h3":
            m = re.search(r"\((G[A-Z])\)", text)
            area = m.group(1) if m else None
            school, context, list_name = None, None, None
            if area:
                out.setdefault(area, {"options": [], "lists": [], "notes": []})
            continue
        if area is None:
            continue
        w = out[area]
        if el.name == "h4":
            text = text.replace("​", "").strip()
            if re.fullmatch(r"List I+", text):
                list_name = text
                w["lists"].append({"type": "list", "text": text, "courses": []})
            else:
                school = context = text
                list_name = None
            continue
        if el.name == "p" and el.find_parent("li"):
            continue
        codes = codes_of(text)
        strong = el.find("strong")
        if not codes:
            label = clean(strong.get_text(" ")).rstrip(":") if strong else ""
            if el.name == "p" and label:
                # "Theater Majors:" / "TUJ students in the BA in Art" label the next sequence;
                # a long list of degree names does not
                context = f"{school} · {label}" if school and len(label) <= 40 else school or label
            elif (el.name == "li" or area == "GG") and not re.search(r"List I|^Any General Education", text):
                w["notes"].append(text)
            continue
        if list_name:
            w["lists"][-1]["courses"].append(
                {"type": "course", "options": [{"codes": c, "title": ""} for c in sequence_options(text)], "credits": None})
            continue
        label = f"Waiver{' · ' + context if context else ''}"
        if re.search(r"sequence|all courses must be completed|set of courses|—|&", text, re.I):
            opts = sequence_options(text)
            w["options"].append({"type": "course", "credits": None,
                                 "options": [{"codes": o, "title": f"{label}: all of {' + '.join(o)}"} for o in opts]})
        else:
            for c in codes:
                w["options"].append({"type": "course", "credits": None, "options": [{"codes": [c], "title": label}]})
    return out


# ---------------------------------------------------------------- area pages

def parse_area_html(html, heading):
    """Approved course list under the '<Area> Courses' heading: [(title, [codes])]."""
    s = BeautifulSoup(html, "html.parser")
    tc = s.select_one("#textcontainer")
    if tc is None:
        return None
    h = next((h for h in tc.find_all(["h2", "h3"]) if clean(h.get_text()).lower() == heading.lower()), None)
    if h is None:
        return None
    rows = []
    for el in h.find_all_next(["h2", "li"]):
        if el.name == "h2":
            break
        text = clean(el.get_text(" ")).replace("​", "")
        codes = gened_codes(text)
        if not codes:
            continue
        title = clean(COURSE_RE.sub("", text)).rstrip(" ,;")
        rows.append((title, codes))
    return rows


def parse_area_pdf(pages, heading):
    """Same list from the bulletin PDF text: '• Title CODE, CODE' bullets, possibly wrapped."""
    for i, page in enumerate(pages[:120]):
        lines = [ln.strip() for ln in page.splitlines()]
        if heading not in lines:
            continue
        text = "\n".join(lines[lines.index(heading) + 1:] + [ln.strip() for p in pages[i + 1:i + 4] for ln in p.splitlines()])
        rows, cur = [], None
        for ln in text.splitlines():
            if not ln or re.match(r"^\d+\s+Temple University Undergraduate Bulletin|^University Requirements: General Education\s+\d+$", ln):
                continue
            ends_with_code = re.search(r"[A-Z]{2,4} \d{4}\)?$", cur) if cur else None
            if ln.startswith("•"):
                if cur:
                    rows.append(cur)
                cur = ln.lstrip("• ").strip()
            elif cur and (not ends_with_code or cur.endswith(",") or re.match(r"^[A-Z]{2,4} \d{4}", ln)):
                cur += " " + ln
            elif rows or cur:
                break
        if cur:
            rows.append(cur)
        out = []
        for r in rows:
            codes = gened_codes(r)
            if codes:
                out.append((clean(COURSE_RE.sub("", r)).rstrip(" ,;"), codes))
        return out
    return None


def split_ih(rows, area):
    """gy-gz lists both Intellectual Heritage courses; I (Good Life) is GY, II (Common Good) is GZ."""
    two = [r for r in rows if re.search(r"Heritage II\b|Common Good", r[0])]
    return two if area == "GZ" else [r for r in rows if r not in two]


# ---------------------------------------------------------------- assemble

def scrape_year(year):
    print(f"== {year}", file=sys.stderr)
    main = None
    for url, canonical, kind in page_urls(year, "general-education/"):
        html = fetch(url)
        tc = BeautifulSoup(html or "", "html.parser").select_one("#textcontainer")
        if tc is not None and tc.select("table.tbl_programframework"):
            main = (tc, url, canonical, kind)
            break
    if main is None:
        print(f"  ! no GenEd page for {year}", file=sys.stderr)
        return None
    tc, main_url, main_canonical, main_kind = main
    framework = parse_framework(tc)
    waivers = parse_waivers(tc)
    pdf_pages = json.loads(PDF_PAGES[year].read_text()) if year in PDF_PAGES and PDF_PAGES[year].exists() else None

    area_rows, area_src = {}, {}
    for slug, heading in sorted(set(AREA_PAGES.values())):
        pdf_rows = parse_area_pdf(pdf_pages, heading) if pdf_pages else None
        pdf_codes = {c for _, cs in pdf_rows for c in cs} if pdf_rows else None
        rows = src = None
        for url, canonical, kind in page_urls(year, f"general-education/{slug}/"):
            r = parse_area_html(fetch(url) or "", heading)
            if not r:
                continue
            codes = {c for _, cs in r for c in cs}
            if pdf_codes is not None and codes != pdf_codes:
                print(f"  ~ {slug}: {url} differs from the {year} PDF "
                      f"(+{sorted(codes - pdf_codes)} -{sorted(pdf_codes - codes)})", file=sys.stderr)
                continue
            rows, src = r, {"url": canonical, "source": url, "sourceKind": kind}
            break
        if rows is None and pdf_rows:
            rows, src = pdf_rows, {"url": f"{YEARS[year]['base']}/general-education/{slug}/",
                                   "source": PDF_URL[year], "sourceKind": "pdf"}
        if rows is None:
            print(f"  ! no course list for {slug}", file=sys.stderr)
            continue
        print(f"   {slug}: {len(rows)} courses ({src['sourceKind']})", file=sys.stderr)
        for area, (s, _) in AREA_PAGES.items():
            if s == slug:
                area_rows[area] = split_ih(rows, area) if slug == "gy-gz" else rows
                area_src[area] = src

    blocks = []
    areas = []
    for heading, codes in (("Foundation Courses", FOUNDATION), ("Breadth Courses", [a for a in framework if a not in FOUNDATION])):
        sections = []
        for code in codes:
            fw = framework.get(code)
            if fw is None or code not in area_rows:
                continue
            w = waivers.get(code, {"options": [], "lists": [], "notes": []})
            courses = [{"type": "course", "credits": None,
                        "options": [{"codes": [c], "title": title} for c in cs]} for title, cs in area_rows[code]]
            item = {"type": "choose", "text": f"{fw['name']} ({code}): {fw['requirement']}",
                    "credits": fw["credits"], "count": fw["count"], "by": "count",
                    "courses": courses + w["options"], "notes": None}
            items = [item]
            for lst in w["lists"]:
                items.append(lst)
            if w["lists"]:
                items.append({"type": "note", "text": "List I / List II courses count toward GS only as one GenEd GS course plus "
                                                      "one List I or II course, or one List I plus one List II course. "
                                                      "Assign them by hand if that applies to you."})
            for n in w["notes"]:
                items.append({"type": "note", "text": n})
            sections.append({"title": f"{fw['name']} ({code})", "items": items})
            areas.append({**fw, "foundation": code in FOUNDATION, **area_src[code],
                          "waiverCount": len(w["options"])})
        blocks.append({"heading": heading, "total": {"min": sum(a["credits"]["min"] for a in areas if a["code"] in codes),
                                                     "max": sum(a["credits"]["max"] for a in areas if a["code"] in codes)},
                       "role": "core", "sections": sections})

    return {
        "year": year,
        "url": main_canonical,
        "source": main_url,
        "sourceKind": main_kind,
        "scrapedAt": time.strftime("%Y-%m-%d"),
        "areas": areas,
        "blocks": blocks,
        "policies": [
            "A GenEd course counts in one GenEd area only.",
            "GenEd courses need a C- or better and cannot be taken credit/no credit.",
            "No more than two courses from a single department may satisfy GenEd (foundation and transfer courses excluded).",
            "Students entering with 45 or more transfer credits follow the 45+ GenEd curriculum instead.",
        ],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default=",".join(YEARS))
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    if args.refresh:
        import scrape_bulletin
        orig = scrape_bulletin.fetch
        globals()["fetch"] = lambda url, refresh=False, tries=4: orig(url, True, tries)
    GENED_OUT.mkdir(parents=True, exist_ok=True)
    for year in args.years.split(","):
        data = scrape_year(year)
        if data:
            (GENED_OUT / f"{year}.json").write_text(json.dumps(data, separators=(",", ":")))


if __name__ == "__main__":
    main()
