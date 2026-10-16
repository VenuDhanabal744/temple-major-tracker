# Temple Major Tracker

A degree-progress tracker for Temple University undergraduates. It uses requirements published in the
[Temple Undergraduate Bulletin](https://bulletin.temple.edu), pulled separately for each catalog year.

## Features

- **Progress**: audits your courses against a major and any second majors or minors, requirement by
  requirement. It handles "or" options, "select N from" lists, and elective rules such as "3 upper-level
  POLS courses numbered 2000–4999". Completed, in-progress and planned courses are tracked separately,
  grades below your minimum are ignored, and you can assign a course to an elective slot by hand.
- **Catalog year by graduating class**: Class of 2027 → 2023-24 bulletin, 2028 → 2024-25,
  2029 → 2025-26, 2030 → 2026-27. Temple's catalog year is the fall term in which you *declared* the
  major, so each program in your plan can be switched to another year.
- **General Education**: a GenEd card on the Progress tab audits the ten GenEd areas (GW, GQ, GY, GZ,
  GA, GB, GD, GG, GS, GU) against the approved course list for your class's bulletin year, with a C-
  minimum. Course-sequence waivers from the bulletin count automatically (MATH 1041 for GQ,
  BIOL 1111 + BIOL 1112 for both GS courses, Boyer/Tyler/Theater sequences for GA, and so on), as do
  waivers your major grants (CST majors waive 2 GS + 1 GQ; TUteach majors also waive GB). Other
  waivers, such as study abroad for GG, can be ticked by hand.
- **Double major finder**: ranks every major or minor by overlap with your primary major (credits
  covered by your major's required courses, plus credits coverable with electives that count for both)
  and by the credits left given your own courses. It also lists shared courses and states Temple's
  double-major-across-colleges policy.
- **Excel import**: drop in an `.xlsx` or `.csv` file. Columns are detected automatically (Course, or
  Subject + Number, plus Title, Credits, Grade, Term and Status). If the sheet has no header row, every
  cell is scanned for course codes. Includes a downloadable template and CSV export. Files are read in
  the browser and never uploaded.
- **Pre-law tracker**: Temple GPA and LSAC GPA (they differ on repeated courses), LSAT scores,
  skill-building coursework checked against your courses, recommendation letters, target-school medians,
  and a dated application timeline. Based on Temple's Pre-Law FAQ. A summary also appears beside your
  major progress.

All data is saved in your browser's localStorage.

## Run it

```bash
npm install
```

```bash
npm run dev
```

## Where the requirements come from

| Catalog year | Source |
| --- | --- |
| 2026-2027 | Live bulletin, `bulletin.temple.edu/undergraduate/…` |
| 2025-2026 | Temple archived this year only as a PDF. Pages come from Internet Archive snapshots of the live bulletin (each page's "matriculated in academic year 2025-2026" banner is checked). Pages the archive missed are filled from the official PDF: when the PDF's course list matches a neighbouring year exactly, that year's structure is reused ("pdf-verified"); otherwise the PDF is parsed directly ("pdf", flagged in the app). |
| 2024-2025, 2023-2024 | `bulletin.temple.edu/archives/<year>/undergraduate/…` |

Each program links to the exact page it was read from.

### Refreshing the data

```bash
python3 scripts/scrape_bulletin.py
```

```bash
python3 -m venv scripts/.venv && scripts/.venv/bin/pip install pypdf beautifulsoup4 requests
```

```bash
scripts/.venv/bin/python scripts/fill_from_pdf.py 2025-2026
```

```bash
scripts/.venv/bin/python scripts/scrape_gened.py
```

`scrape_gened.py` writes `public/data/gened/<year>.json`. For 2025-2026 each area's course list comes
from an Internet Archive snapshot only when its courses match the official PDF; otherwise the PDF list
is used (flagged per area in the app).

`scrape_bulletin.py` caches pages in `scripts/.cache/`; pass `--refresh` to refetch. When Temple
publishes the 2027-2028 bulletin, archive 2026-2027 in `YEARS`, add the new year, and extend `GRAD_YEARS`
in `src/lib/catalog.ts`.

## Limits

This is a planning aid, not an official degree audit; always confirm with DARS and your advisor.
College-wide requirements (credit totals, upper-level credits, language) are shown as notes from the
bulletin, not tracked. GenEd does not model the 45+ transfer curriculum, and GS List I / List II
substitutions need a manual assignment. Free-text elective rules without a subject ("two lab
science courses") need a manual assignment.
