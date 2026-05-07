# INSEE supplier enrichment pipeline — architecture

This document describes **`enrich_suppliers.py`**: data flow, Python dependencies, environment variables, external calls, and where each stage runs in code.

---

## 1. Purpose (one sentence)

Read a ** Excel** export, split rows into **FR** (France) vs **NON-FR**, resolve **FR** suppliers against **INSEE Sirene API v3.11**, normalize **NON-FR** addresses with **Gemini**, then write a **`;`-separated UTF-8-BOM CSV** next to the input file.

---

## 2. Dependencies

### 2.1 Python packages (`requirements.txt`)

| Package | Role |
|---------|------|
| **pandas** | Excel → `DataFrame`, row iteration, CSV export |
| **openpyxl** | Engine for `read_excel` (`.xlsx`) |
| **requests** | HTTP `GET` to INSEE REST API |
| **google-generativeai** | `GenerativeModel("gemini-2.5-flash")` for Gemini |
| **python-dotenv** | `load_dotenv()` so `.env` fills `os.environ` |

### 2.2 Runtime

- **Python 3.10+** (type hints `list[str]`, `dict \| None`, etc.).
- **Network** for INSEE and Google (unless every URL is cache hits — unlikely on first run).

### 2.3 Secrets & config (environment)

| Variable | Used for |
|----------|----------|
| `VITE_INSEE_API_KEY` … `VITE_INSEE_API_KEY10` | Round-robin INSEE keys (any subset may be set; empty keys skipped) |
| `VITE_GEMINI_API_KEY` | Gemini |
| `VITE_API_BASE_URL` | Optional override; default `https://api.insee.fr/api-sirene/3.11` |
| `LOG_API_CALLS` | If `1`, logs INSEE/Gemini activity to stderr |

Loaded at import time via **`load_dotenv()`** (file: `.env` in cwd).

---

## 3. High-level process (ASCII)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLI: enrich_suppliers.py                           │
│  args: <xlsx_path>  [--limit N]  [--mode all|fr|non-fr]                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  load_data()  —  pandas.read_excel(engine="openpyxl")                        │
│  • Normalize country → FRA vs ISO-like codes                                 │
│  • Search_Name, Search_Address, _cp, Heuristic_Flags, Processing_Group       │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                              │
         _is_fr == True                    _is_fr == False
                    │                              │
                    ▼                              ▼
         ┌──────────────────┐           ┌──────────────────┐
         │   search_fr()    │           │  enrich_nonfr()  │
         │  (INSEE + Gemini)│           │     (Gemini)     │
         └──────────────────┘           └──────────────────┘
                    │                              │
                    └──────────────┬───────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │  _build_row() per outcome    │
                    │  → list of dicts             │
                    └──────────────────────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │  DataFrame.to_csv(           │
                    │    sep=';',                  │
                    │    encoding='utf-8-sig')     │
                    │  enriched_suppliers_<ts>.csv │
                    └──────────────────────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │  Summary counts → stderr     │
                    └──────────────────────────────┘
```

---

## 4. Where each part lives (file map)

| Concern | Location in `enrich_suppliers.py` |
|---------|-----------------------------------|
| Config, keys, `BASE_URL`, delays | Top: `CONFIG` block |
| INSEE + Gemini caches | `_c_insee`, `_c_gemini`, `_ghash` |
| Stderr logging | `_log_insee`, `_log_gemini`, `_log_row` |
|  column names & `load_data` | `LEVEL 1`, `load_data` |
| Text / SIRET / SIREN / CP / city | `LEVEL 2` helpers |
| Lucene-style name query | `build_name_query`, `STOP_LEGAL` |
| INSEE HTTP | `_insee_fetch`, `_insee_get`, `_has`, `_jp` |
| FR candidate scoring | `_score_candidate`, `_best_candidate` |
| Establishment → output columns | `_norm_etab` |
| FR tiered search | `search_fr` |
| FR Gemini assist | `_init_gemini`, `_gemini_call`, `_parse_gemini`, `_tier4` |
| NON-FR Gemini | `_SYSTEM_NONFR`, `_nonfr_user_prompt`, `enrich_nonfr` |
| Output column order | `PASSTHROUGH`, `DERIVED_COLS`, `FR_COLS`, `NF_COLS`, `ALL_COLS` |
| Entry point | `main()` |

---

## 5. External calls

### 5.1 INSEE API (HTTPS)

All requests use:

- **Method:** `GET`
- **Header:** `X-INSEE-Api-Key-Integration: <key>` (key from `_next_key()` round-robin)
- **Header:** `Accept: application/json`
- **Base URL:** `BASE_URL` (default v3.11)

**Endpoints actually used:**

| Tier / label | URL pattern | Purpose |
|--------------|-------------|---------|
| `T1A` | `{BASE_URL}/siret/{14-digit}` | Validate SIRET → single establishment |
| `T1B`, `T4-SIREN` | `{BASE_URL}/siret?q=siren:{siren}&nombre=50` | List establishments for SIREN |
| `T2`, `T3`, `T5`, `T4-NAME`, `T4-DET` | `{BASE_URL}/siret?q=<Lucene query>&nombre=20|50` | Search by name + optional CP / dept |

**Response shape:** JSON with `etablissement` (single) or `etablissements` + `header` (search). `404` / empty `etablissements` → tier continues or fails.

**Rate limits:** On **429**, `requests` retry loop waits **5s, 10s, 15s** (per attempt index). **Per successful call:** `time.sleep(DELAY_INSEE)` with **`DELAY_INSEE = 2.5`** s.

**Caching:** Full URL string → parsed JSON in `_c_insee` (in-memory).

---

### 5.2 Gemini API (Google)

| Path | Usage |
|------|--------|
| `_init_gemini()` | `google.generativeai` → `configure(api_key=…)` → `GenerativeModel("gemini-2.5-flash")` |
| `_gemini_call()` | `model.generate_content(prompt)` — used inside **FR Tier 4** (`_tier4`) |
| `enrich_nonfr()` | `model.generate_content([_SYSTEM_NONFR + "\n\n" + user_msg])` — single concatenated prompt |

**Parsing:** Response text → regex extract JSON block `{...}` or fenced ```json — `_parse_gemini`.

**Rate limits:** On **429 / ResourceExhausted**, wait **10s** and retry once.

**Delay after call:** `DELAY_GEMINI = 0.5` s in several places.

**Caching:** MD5 key → parsed dict in `_c_gemini` (shared across FR helper calls and NON-FR).

---

## 6. FR pipeline detail (ASCII)

`search_fr(row)` — approximate order of **decisions** and **HTTP calls** (not every branch runs every time):

```
                    ┌─────────────┐
                    │  TIER 0     │  Pretri: empty name → ERROR
                    │  pretri     │  placeholder + no SIRET/CP → NOT_FOUND
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │  TIER 1A (if 14-digit SIRET)   GET /siret/{siret}
              │  Active → SUCCESS (TIER1A_VALIDATED)
              └────────────┬────────────┘
                           │ (if not resolved)
              ┌────────────┴────────────┐
              │  TIER 1B (if 9-digit SIREN)  GET /siret?q=siren:...&nombre=50
              │  _best_candidate (min 30)
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │  build_name_query(sn)   │  (Lucene query from name)
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │  TIER 2 (if CP)         GET  q = name AND codePostalEtablissement:{cp}
              │  min_score 20
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │  TIER 3 (if dept)       GET  q = name AND codePostalEtablissement:{dept}*
              │  min_score 10
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │  TIER 4  _tier4()        Gemini (identification JSON)
              │                         → optional SIREN GET /siret?q=siren:...
              │                         → optional name+dept GET
              │          then Gemini (detective variations JSON)
              │                         → loop up to 3 name variants + dept GET
              └────────────┬────────────┘
                           │ (if still None)
              ┌────────────┴────────────┐
              │  TIER 5                 GET  q = name only &nombre=50
              │  min_score 30
              └────────────┬────────────┘
                           ▼
                    NOT_FOUND or FR_* status
```

**Scoring** ( `_score_candidate` ): active establishment, siège, CP match / dept, commune vs normalized city, name token overlap — used whenever multiple `etablissements` are returned.

---

## 7. NON-FR pipeline detail (ASCII)

```
enrich_nonfr(row)
        │
        ├─► Name starts with "AVANCE" ──► SKIPPED_ADVANCE (no Gemini)
        │
        ├─► No address in A1/A2/A3/CP/Ville ──► SKIPPED_NO_DATA (no Gemini)
        │
        └─► Else ──► Gemini (system + user prompt)
                    • Parse JSON → corrected_* fields
                    • Merge heuristic flags + Gemini review_flags
                    • Output AI_* columns
```

**INSEE is not called** for NON-FR rows.

---

## 8. Output artifact

| Item | Detail |
|------|--------|
| **Path** | Same directory as input Excel: `enriched_suppliers_<YYYY-MM-DD_HH-MM-SS>.csv` |
| **Separator** | `;` |
| **Encoding** | `utf-8-sig` (BOM for Excel) |
| **Columns** | `PASSTHROUGH` + derived + `FR_*` + `AI_*` (see `ALL_COLS` in script) |

---

## 9. Operational knobs (summary)

| Knob | Value / behavior |
|------|------------------|
| INSEE inter-request delay | `DELAY_INSEE = 2.5` s after each INSEE GET in normal path |
| Gemini delay | `DELAY_GEMINI = 0.5` s |
| INSEE key rotation | `_next_key()` cycles `API_KEYS` |
| INSEE cache | Key = full request URL |
| Gemini cache | Key = MD5 of prompt inputs (see `_ghash` usages) |

---

## 10. Reference implementation

The JS stack in this repo (**`src/services/batch/searchLogic.js`**, **`src/api/queryBuilder.js`**) is the behavioral reference for the **FR** Lucene queries and tier ordering; the Python script ports that logic into a batch CLI.
