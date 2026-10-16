#!/usr/bin/env python3
"""Scrape Temple University Undergraduate Bulletin program requirements.

Each catalog year is pulled from its own published source so a student sees the
requirements for *their* bulletin year:

  2026-2027  https://bulletin.temple.edu/undergraduate/...            (current)
  2025-2026  Wayback Machine snapshots of the live site (Aug 2025 - Jul 2026);
             Temple only archived this year as a PDF
  2024-2025  https://bulletin.temple.edu/archives/2024-2025/undergraduate/...
  2023-2024  https://bulletin.temple.edu/archives/2023-2024/undergraduate/...

Every page's "These requirements are for students who matriculated in academic
year X" banner is checked against the year we asked for, and pages that don't
match are dropped.

Usage:  python3 scripts/scrape_bulletin.py [--years 2026-2027,2025-2026] [--refresh]
Output: public/data/<year>.json and public/data/index.json
"""

import argparse
import concurrent.futures as cf
import hashlib
import json
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache"
OUT = ROOT / "public" / "data"
HOST = "https://bulletin.temple.edu"

COLLEGES = {
    "boyer-music-dance": "Boyer College of Music and Dance",
    "education": "College of Education and Human Development",
    "engineering": "College of Engineering",
    "fox-business-management": "Fox School of Business and Management",
    "liberal-arts": "College of Liberal Arts",
    "media-communication": "Klein College of Media and Communication",
    "pharmacy": "School of Pharmacy",
    "public-health": "College of Public Health",
    "science-technology": "College of Science and Technology",
    "social-work": "School of Social Work",
    "theater-film-media-arts": "School of Theater, Film and Media Arts",
    "tourism-hospitality-management": "School of Sport, Tourism and Hospitality Management",
    "tyler": "Tyler School of Art and Architecture",
    "university-college": "University College",
    "intercollegial-programs": "Intercollegial Programs",
}

YEARS = {
    "2026-2027": {"kind": "live", "base": f"{HOST}/undergraduate"},
    "2025-2026": {"kind": "wayback", "base": f"{HOST}/undergraduate",
                  "from": "20250801", "to": "20260715"},
    "2024-2025": {"kind": "live", "base": f"{HOST}/archives/2024-2025/undergraduate"},
    "2023-2024": {"kind": "live", "base": f"{HOST}/archives/2023-2024/undergraduate"},
}

DEGREE_RE = re.compile(r"-(ba|bs|bba|bsed|bfa|bm|bsw|bsn|bgs|bs[a-z]{2,5}|minor)/?$")
COURSE_RE = re.compile(r"\b([A-Z]{2,4})\s?(\d{4})\b")

session = requests.Session()
session.headers["User-Agent"] = "TempleMajorTracker/1.0 (student degree planning tool)"


def fetch(url, refresh=False, tries=4):
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".html")
    if key.exists() and not refresh:
        return key.read_text()
    for attempt in range(tries):
        try:
            r = session.get(url, timeout=60)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            key.write_text(r.text)
            return r.text
        except requests.RequestException as e:
            if attempt == tries - 1:
                print(f"  ! {url}: {e}", file=sys.stderr)
                return None
            time.sleep(2 * (attempt + 1))


# ---------------------------------------------------------------- enumeration

def list_programs_live(base):
    found = {}
    for slug in COLLEGES:
        html = fetch(f"{base}/{slug}/")
        if not html:
            continue
        for m in re.finditer(r'href="(?:[^"]*?)/undergraduate/([a-z-]+)/([a-z0-9-]+)/"', html):
            college, prog = m.groups()
            if college == slug and DEGREE_RE.search(prog + "/"):
                found.setdefault(prog, college)
    return found


def list_programs_wayback(cfg):
    url = ("https://web.archive.org/cdx/search/cdx?url=bulletin.temple.edu/undergraduate/"
           f"&matchType=prefix&from={cfg['from']}&to={cfg['to']}&filter=statuscode:200"
           "&fl=timestamp,original")
    text = fetch(url)
    snaps = {}
    for line in (text or "").splitlines():
        ts, orig = line.split(" ", 1)
        m = re.search(r"/undergraduate/([a-z-]+)/([a-z0-9-]+)/?$", orig)
        if not m or m.group(1) not in COLLEGES or not DEGREE_RE.search(m.group(2) + "/"):
            continue
        # keep every snapshot; the newest is tried first, older ones are fallbacks
        snaps.setdefault((m.group(2), m.group(1)), []).append(ts)
    return snaps


# ---------------------------------------------------------------- parsing

def clean(t):
    return re.sub(r"\s+", " ", t or "").strip()


def parse_hours(s):
    s = clean(s)
    m = re.match(r"^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?$", s)
    if not m:
        return None
    lo = float(m.group(1))
    hi = float(m.group(2)) if m.group(2) else lo
    return {"min": lo, "max": hi}


WORDNUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
           "eight": 8, "nine": 9, "ten": 10, "a": 1, "an": 1}


def parse_count(text):
    t = text.lower()
    m = re.search(r"\b(?:select|choose|take|complete)\s+(?:any\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b(?!\s*(?:-\s*\d+\s*)?(?:credit|s\.h|semester))", t)
    if m:
        v = m.group(1)
        return int(v) if v.isdigit() else WORDNUM[v]
    return None


def parse_rule(text):
    """Turn free-text elective descriptions into a machine-checkable rule, when possible.

    e.g. "Select 3 upper-level Political Science courses numbered 2000-4999"
    -> {"levels": [2000, 4999]}   (subjects come from the program's own codes, see below)
    """
    rule = {}
    m = re.search(r"(\d{4})\s*(?:-|–|to|through)\s*(\d{4})", text)
    if m:
        rule["levels"] = [int(m.group(1)), int(m.group(2))]
    elif re.search(r"upper[- ]level", text, re.I):
        rule["levels"] = [2000, 4999]
    elif re.search(r"(\d)000[- ]level", text):
        d = int(re.search(r"(\d)000[- ]level", text).group(1))
        rule["levels"] = [d * 1000, d * 1000 + 999]
    subs = sorted(set(re.findall(r"\b([A-Z]{2,4})\b(?=\s*(?:courses?|electives?|\d{4}|$|[,;)]| or | and ))", text))
                  - {"WI", "GPA", "AND", "OR", "THE", "OF", "SH", "CLA", "CST", "US", "IH", "II", "III", "IV"})
    if subs:
        rule["subjects"] = subs
    return rule or None


def codes_in(td):
    codes = []
    for a in td.select("a.code, a.bubblelink"):
        m = COURSE_RE.search(a.get_text(" ", strip=True).replace("\xa0", " "))
        if m:
            codes.append(f"{m.group(1)} {m.group(2)}")
    if not codes:
        for m in COURSE_RE.finditer(td.get_text(" ", strip=True).replace("\xa0", " ")):
            codes.append(f"{m.group(1)} {m.group(2)}")
    return codes


def parse_table(table):
    """Parse a CourseLeaf sc_courselist table into sections of requirement items."""
    sections = []
    cur = {"title": None, "items": []}
    sections.append(cur)
    group = None  # an open "select from the following" item collecting its course rows
    total = None
    last_course = None
    selectish = re.compile(r"select|choose|from the following|one of|electives?|courses? (?:in|from|numbered)", re.I)

    for tr in table.select("tbody > tr"):
        cls = tr.get("class") or []
        tds = tr.find_all("td", recursive=False)
        if not tds:
            continue
        hours_td = tr.find("td", class_="hourscol")
        hours = parse_hours(hours_td.get_text()) if hours_td else None
        indented = tr.find(class_="blockindent") is not None
        for sup in tr.find_all("sup"):
            sup.extract()

        if "listsum" in cls:
            total = hours
            continue

        comment = tr.find("span", class_="courselistcomment")
        is_header = "areaheader" in cls

        if is_header and not indented:
            group = None
            cur = {"title": clean(comment.get_text() if comment else tds[0].get_text()), "items": []}
            sections.append(cur)
            last_course = None
            continue

        if comment is not None and not tr.select("a.code, a.bubblelink"):
            text = clean(comment.get_text())
            # sub-headings inside a list ("Ancient", "Select from:") keep the list open
            if group is not None and (indented or (not hours and not parse_count(text))):
                group["notes"].append(text)
                continue
            if hours or parse_count(text) or selectish.search(text) or is_header:
                group = {"type": "choose", "text": text, "credits": hours,
                         "count": parse_count(text), "courses": [], "notes": []}
                cur["items"].append(group)
            else:
                group = None
                cur["items"].append({"type": "note", "text": text})
            last_course = None
            continue

        codes = codes_in(tds[0])
        if not codes:
            text = clean(tr.get_text(" "))
            if text:
                cur["items"].append({"type": "note", "text": text})
            continue
        title = clean(tds[1].get_text()) if len(tds) > 1 else ""

        if "orclass" in cls:
            if last_course is not None:
                last_course["options"].append({"codes": codes, "title": title})
            continue

        course = {"type": "course", "options": [{"codes": codes, "title": title}], "credits": hours}
        # rows with blank hours belong to the open "select" list even when not indented
        if group is not None and (indented or hours is None):
            group["courses"].append(course)
        else:
            group = None
            cur["items"].append(course)
        last_course = course

    sections = [s for s in sections if s["items"]]
    link_named_lists(sections)
    for s in sections:
        for it in s["items"]:
            if it["type"] == "choose":
                if not it["courses"]:
                    it["type"] = "rule"
                    it.pop("courses")
                    it["rule"] = parse_rule(it["text"])
                it["notes"] = it["notes"] or None
    return sections, total


def link_named_lists(sections):
    """A section that is only a list of blank-hour courses (e.g. "Sexuality Electives") is the
    pool for an earlier "Select two courses from the Sexuality Electives list" line. Move the
    courses into that line; if nothing refers to the list, keep it as a non-counting reference."""
    selects = [it for s in sections for it in s["items"] if it["type"] == "choose"]
    for s in sections:
        items = [it for it in s["items"] if it["type"] != "note"]
        if len(items) < 2 or any(it["type"] != "course" or it["credits"] for it in items):
            continue
        key = re.sub(r"\b(courses?|electives?|list|requirements?)\b", "", (s["title"] or "").lower()).strip(" :-")
        target = next((g for g in selects if key and key in g["text"].lower() and not g["courses"]), None)
        if target is None and key:
            target = next((g for g in selects if key in g["text"].lower()), None)
        if target is not None:
            target["courses"].extend(items)
            s["items"] = [it for it in s["items"] if it["type"] == "note"] + [
                {"type": "note", "text": f"Courses for: {target['text']}"}]
        else:
            s["items"] = [{"type": "list", "text": s["title"] or "Course list", "courses": items}]


def parse_program(html, url):
    s = BeautifulSoup(html, "html.parser")
    title_el = s.select_one("h1.page-title") or s.find("h1")
    name = clean(title_el.get_text()) if title_el else url
    req = s.select_one("#requirementstextcontainer")
    if req is None:
        return None
    banner = clean(req.get_text(" "))[:600]
    m = re.search(r"matriculated (?:in|during) (?:the )?(?:academic year )?(\d{4})\s*-\s*(\d{4})", banner)
    stated_year = f"{m.group(1)}-{m.group(2)}" if m else None

    # narrative text blocks (college requirements, WI courses, etc.) shown as notes
    notes = []
    for el in req.find_all(["h2", "h3", "h4", "p", "li"], recursive=True):
        if el.find_parent("table"):
            continue
        if el.name == "li" and el.find_parent("li"):
            continue
        t = clean(el.get_text(" "))
        if not t or t.startswith("These requirements are for students who matriculated"):
            continue
        notes.append({"tag": el.name, "text": t})

    blocks = []
    for table in req.select("table.sc_courselist"):
        secs, tot = parse_table(table)
        if not secs:
            continue
        h = table.find_previous(["h2", "h3", "h4", "h5"])
        heading = clean(h.get_text(" ")) if h and req in h.parents else None
        blocks.append({"heading": heading, "total": tot, "sections": secs})
    has_core_total = any(b["total"] for b in blocks)
    for b in blocks:
        hd = (b["heading"] or "").lower()
        if re.search(r"writing[- ]intensive|\bwi\b", hd):
            b["role"] = "info"
        elif re.search(r"concentration|track|option|specialization|emphasis|pathway", hd):
            b["role"] = "concentration"
        elif b["total"] or not has_core_total:
            b["role"] = "core"
        else:
            b["role"] = "info"
    # parallel tables like "Program Requirements (Voice)" / "Program Requirements (Piano)" are
    # alternative tracks, not cumulative requirements
    prefixes = {}
    for b in blocks:
        m = re.match(r"^(.*?)\s*\(", b["heading"] or "")
        if m and b["total"] and b["role"] in ("core", "concentration"):
            prefixes.setdefault(m.group(1).lower(), []).append(b)
    for group in prefixes.values():
        if len(group) > 1:
            for b in group:
                b["role"] = "concentration"
    sections = [sec for b in blocks for sec in b["sections"]]
    totals = [b["total"] for b in blocks if b["role"] == "core" and b["total"]]

    footnotes = []
    for fn in req.select("dl.sc_footnotes dd, .sc_footnotes dd"):
        footnotes.append(clean(fn.get_text(" ")))

    m = re.search(r"(?:minimum|total) of (\d{3}) (?:credits|semester hours)", clean(req.get_text(" ")), re.I)
    degree_credits = int(m.group(1)) if m else None
    if degree_credits is None:
        # every major's Academic Plan tab ends with the degree's "Total Credit Hours"
        plan = s.select_one("#academicplantextcontainer")
        plan_totals = [int(t) for t in re.findall(r"Total Credit Hours:?\s*(\d{3})", clean(plan.get_text(" ")))] if plan else []
        degree_credits = max(plan_totals) if plan_totals else None

    # rules without explicit subjects inherit the subjects the program itself requires most
    subj_counts = {}
    for sec in sections:
        for it in iter_courses(sec["items"]):
            for o in it["options"]:
                for c in o["codes"]:
                    subj_counts[c.split()[0]] = subj_counts.get(c.split()[0], 0) + 1
    home = max(subj_counts, key=subj_counts.get) if subj_counts else None
    for sec in sections:
        for it in sec["items"]:
            if it["type"] == "rule" and it.get("rule") and "subjects" not in it["rule"] and home:
                field = re.sub(r",?\s*(BA|BS|BBA|BFA|BM|BSEd|BSW|Minor|B[A-Z][A-Za-z]*)$", "", name).strip()
                t = it["text"]
                explicit_range = re.search(r"numbered\s+\d{4}\s*(?:-|–|to|through)\s*\d{4}", t)
                elsewhere = re.search(r"\b(any|outside|other|non-|elsewhere|college|university|GenEd|general education)\b", t, re.I)
                if re.search(r"\b(major|department|discipline|in the field)\b", t, re.I) or \
                   (field and field.lower() in t.lower()) or (explicit_range and not elsewhere):
                    it["rule"]["subjects"] = [home]
                    it["rule"]["inferred"] = True

    return {
        "name": name,
        "statedYear": stated_year,
        "majorCredits": {"min": sum(t["min"] for t in totals), "max": sum(t["max"] for t in totals)} if totals else None,
        "degreeCredits": degree_credits,
        "blocks": blocks,
        "footnotes": footnotes,
        "notes": notes[:40],
    }


def iter_courses(items):
    for it in items:
        if it["type"] == "course":
            yield it
        elif it["type"] == "choose":
            yield from it.get("courses", [])


def degree_of(slug):
    d = DEGREE_RE.search(slug + "/").group(1)
    return "Minor" if d == "minor" else d.upper().replace("BSED", "BSEd")


# ---------------------------------------------------------------- driver

def scrape_year(year, refresh=False):
    cfg = YEARS[year]
    print(f"== {year}", file=sys.stderr)
    jobs = []
    if cfg["kind"] == "live":
        for prog, college in list_programs_live(cfg["base"]).items():
            jobs.append((prog, college, [f"{cfg['base']}/{college}/{prog}/"]))
    else:
        seen = set()
        for (prog, college), stamps in sorted(list_programs_wayback(cfg).items()):
            if prog in seen:
                continue
            seen.add(prog)
            src = f"{cfg['base']}/{college}/{prog}/"
            urls = [f"https://web.archive.org/web/{ts}id_/{src}" for ts in sorted(stamps, reverse=True)[:3]]
            jobs.append((prog, college, urls))

    def work(job):
        prog, college, urls = job
        for url in urls:
            html = fetch(url, refresh)
            if not html:
                continue
            p = parse_program(html, url)
            if p is None:
                continue
            if p["statedYear"] and p["statedYear"] != year:
                continue  # snapshot belongs to another bulletin year
            canonical = url.split("id_/", 1)[-1]
            p.update({"id": prog, "college": COLLEGES[college], "collegeSlug": college,
                      "degree": degree_of(prog), "year": year, "url": canonical,
                      "source": url if "web.archive.org" in url else canonical,
                      "sourceKind": cfg["kind"]})
            return p
        print(f"  - no {year} page for {prog}", file=sys.stderr)
        return None

    workers = 4 if cfg["kind"] == "wayback" else 8
    programs = []
    with cf.ThreadPoolExecutor(workers) as ex:
        for p in ex.map(work, jobs):
            if p:
                programs.append(p)
    programs.sort(key=lambda p: (p["degree"] == "Minor", p["name"]))
    print(f"   {len(programs)} programs", file=sys.stderr)
    return programs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default=",".join(YEARS))
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    index_path = OUT / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {"years": {}}
    for year in args.years.split(","):
        programs = scrape_year(year, args.refresh)
        (OUT / f"{year}.json").write_text(json.dumps({"year": year, "programs": programs}, separators=(",", ":")))
        index["years"][year] = {
            "count": len(programs),
            "majors": sum(p["degree"] != "Minor" for p in programs),
            "minors": sum(p["degree"] == "Minor" for p in programs),
            "source": YEARS[year]["kind"],
            "scrapedAt": time.strftime("%Y-%m-%d"),
        }
    index["years"] = dict(sorted(index["years"].items(), reverse=True))
    index_path.write_text(json.dumps(index, indent=2))


if __name__ == "__main__":
    main()
