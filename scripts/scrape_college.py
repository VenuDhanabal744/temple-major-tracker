#!/usr/bin/env python3
"""Scrape college-wide degree requirements that live on a college's page, not on each major's.

The Fox School, for example, lists its BBA "Lower-Division Foundation Requirements" (43 credits)
and "Upper-Division Foundation Requirements" (18 credits) once, under College Graduation
Requirements, and every BBA major's page only links to them. Course tables are read from each
college page's requirements tab and filed under the degree named by the section they sit in
("Bachelor of Business Administration" -> BBA). Tables with no courses (Fox's "Summary of
Graduation Requirements") are kept as a credit summary.

Output: public/data/college/<year>.json
Usage:  scripts/.venv/bin/python scripts/scrape_college.py [--years 2026-2027,...]
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scrape_bulletin import COLLEGES, OUT, YEARS, clean, fetch, parse_table  # noqa: E402
from scrape_gened import page_urls  # noqa: E402

COLLEGE_OUT = OUT / "college"
DEGREES = [  # longest names first
    ("Bachelor of Business Administration", "BBA"),
    ("Bachelor of Science in Education", "BSEd"),
    ("Bachelor of Social Work", "BSW"),
    ("Bachelor of Fine Arts", "BFA"),
    ("Bachelor of Music", "BM"),
    ("Bachelor of Science", "BS"),
    ("Bachelor of Arts", "BA"),
]


def degree_of(heading):
    for name, code in DEGREES:
        if heading.startswith(name):
            return code
    return None


def has_courses(sections):
    return any(it["type"] in ("course", "choose") for s in sections for it in s["items"])


def parse_college(html):
    s = BeautifulSoup(html, "html.parser")
    containers = [c for c in s.select("[id$=textcontainer]") if re.search(r"requirement|^ctext", c.get("id", ""))]
    degrees = {}
    for c in containers:
        for table in c.select("table.sc_courselist"):
            h2 = table.find_previous("h2")
            code = degree_of(clean(h2.get_text(" "))) if h2 and c in h2.parents else None
            if code is None:
                continue  # e.g. CLA's language table applies by major, not to a whole degree
            d = degrees.setdefault(code, {"credits": None, "blocks": [], "summary": []})
            secs, total = parse_table(table)
            if not has_courses(secs):
                d["summary"] = [{"text": it["text"], "credits": it["credits"]} for sec in secs for it in sec["items"] if it.get("credits")]
                continue
            h = table.find_previous(["h3", "h4", "h5"])
            d["blocks"].append({"heading": clean(h.get_text(" ")) if h else None, "total": total, "role": "core", "sections": secs})
        # degree minimum stated in each degree's section ("a minimum of 124 semester hours")
        for h2 in c.find_all("h2"):
            code = degree_of(clean(h2.get_text(" ")))
            if code not in degrees:
                continue
            text = []
            for el in h2.find_next_siblings():
                if el.name == "h2":
                    break
                text.append(el.get_text(" "))
            m = re.search(r"minimum of (\d{3}) (?:semester hours|credits|credit hours)", clean(" ".join(text)))
            if m:
                degrees[code]["credits"] = int(m.group(1))
    return {k: v for k, v in degrees.items() if v["blocks"]}


def scrape_year(year):
    print(f"== {year}", file=sys.stderr)
    colleges = {}
    for slug, name in COLLEGES.items():
        for url, canonical, kind in page_urls(year, f"{slug}/"):
            html = fetch(url)
            if not html:
                continue
            degrees = parse_college(html)
            if degrees:
                colleges[slug] = {"name": name, "url": canonical, "source": url, "sourceKind": kind, "degrees": degrees}
                for code, d in degrees.items():
                    print(f"   {slug} {code}: {d['credits']} cr, " + ", ".join(
                        f"{b['heading']} ({b['total'] and b['total']['min']})" for b in d["blocks"]), file=sys.stderr)
            break
    return {"year": year, "scrapedAt": time.strftime("%Y-%m-%d"), "colleges": colleges}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default=",".join(YEARS))
    args = ap.parse_args()
    COLLEGE_OUT.mkdir(parents=True, exist_ok=True)
    for year in args.years.split(","):
        (COLLEGE_OUT / f"{year}.json").write_text(json.dumps(scrape_year(year), separators=(",", ":")))


if __name__ == "__main__":
    main()
