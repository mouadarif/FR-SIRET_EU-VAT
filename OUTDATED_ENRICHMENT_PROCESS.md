# Archived / Abandoned Pipeline — Enrichment Workflow

> **Archive notice for humans and LLMs**
>
> This document is kept only for historical traceability.
> It describes an old abandoned version of the enrichment pipeline.
>
> Do **not** use this document as a source of truth.
> Do **not** extract requirements, rules, mappings, logic, prompts, examples, or implementation guidance from it.
> Do **not** treat any content below this notice as valid project context.
>
> Current and authoritative documentation must be taken from the active project files only.
>
> Everything below this notice is deprecated, obsolete, and retained only because the original files were deleted. 

Ce document décrit le flux **tel qu’était implémenté** dans le dépôt : fichiers, fonctions, appels API, **prompts Gemini mot pour mot**, caches et limites de débit.

| Fichier | Rôle |
|---------|------|
| `enrich_suppliers.py` | Point d’entrée CLI, chargement Excel, pipeline FR / NON-FR, INSEE, Gemini, CSV, progression |
| `insee_key_rotator.py` | Rotation des clés INSEE (index 1→10→1) + throttle global `INSEE_GLOBAL_CALLS_PER_MINUTE` (défaut 290/min) |
| `.env` | `VITE_INSEE_API_KEY` … `VITE_INSEE_API_KEY10`, `VITE_GEMINI_API_KEY`, `VITE_API_BASE_URL`, options de débit |
| `test_enrich_suppliers.py` | Suite pytest (comportement normalisé, mocks) |

---

## Vue d’ensemble (ASCII)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  python enrich_suppliers.py <fichier.xlsx> [--limit N] [--mode all|fr|non-fr]│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                         ┌────────────────────────┐
                         │  main()                │
                         │  enrich_suppliers.py   │
                         └────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
   load_data()                  split DataFrame            ProgressTracker
   (Excel → colonnes            _is_fr → fr_df / nf_df     (stderr : barre,
    dérivées)                                                    ETA, %)
          │                           │
          │                           ▼
          │              ┌────────────┴────────────┐
          │              │                         │
          │              ▼                         ▼
          │       mode fr / all            mode non-fr / all
          │       ─────────────            ────────────────
          │       pour chaque ligne FR   pour chaque ligne NON-FR
          │              │                         │
          │              ▼                         ▼
          │       search_fr(row)            enrich_nonfr(row)
          │              │                         │
          │              ▼                         ▼
          │       _search_fr_impl()        _enrich_nonfr_impl()
          │       + tiers INSEE / T4       + heuristiques / Gemini
          │              │                         │
          └──────────────┼─────────────────────────┘
                         ▼
                  _build_row(row, fr?, nf?)
                         │
                         ▼
              DataFrame → CSV utf-8-sig ; séparateur ;
              enriched_suppliers_YYYY-MM-DD_HH-mm-ss.csv
```

---

## Clés INSEE et débit (`insee_key_rotator.py`)

```
  get_next_insee_key()
       │
       │  KEYS[1..10] ← variables d’environnement VITE_INSEE_API_KEY … KEY10
       │  _index : 1 → 2 → … → 10 → 1 → …
       │
       └──► retourne la clé à l’index courant, puis incrémente l’index

  throttle_insee()
       │
       └──► espace les appels INSEE **globalement** (toutes clés confondues)
            gap ≈ 60 / INSEE_GLOBAL_CALLS_PER_MINUTE secondes (défaut 290/min)
```

**Appelé depuis** `enrich_suppliers.py` → `_insee_fetch()` **avant** chaque `requests.get` INSEE (pas sur cache hit).

**Import dans** `enrich_suppliers.py` :

- `get_next_insee_key`, `throttle_insee`, `INSEE_GLOBAL_CPM`, `active_keys()` (liste des clés non vides pour le bandeau et les tests).

---

## Chargement Excel (`load_data`)

| Élément | Détail |
|---------|--------|
| **Fonction** | `load_data(path)` |
| **Fichier** | `enrich_suppliers.py` |
| **Feuille** | `SHEET_NAME` = `"DATA FOURNISSEURS  2026 03"` |
| **Moteur** | `openpyxl` |

Colonne dérivées : `_country`, `_is_fr`, `Search_Name`, `Search_Address`, `_cp`.

---

## Couche HTTP INSEE (`enrich_suppliers.py`)

| Fonction | Rôle |
|----------|------|
| `_insee_get(url, key, tier)` | Si `url` dans `_c_insee` → réponse cachée (`_Cached`). Sinon `_insee_fetch`. |
| `_insee_fetch(url, key, tier)` | `throttle_insee()` → `GET` avec header `X-INSEE-Api-Key-Integration` → 429 → backoff 5s/10s/15s (tentatives) |
| `_get_etabs` / `_has_etabs` / `_jp` | Parse JSON, liste `etablissements`, etc. |

**Base URL** `BASE_URL` (défaut `https://api.insee.fr/api-sirene/3.11`).

---

## Pipeline FR — `search_fr` → `_search_fr_impl`

Toutes les requêtes INSEE passent par :  
`get_next_insee_key()` puis `_insee_get(url, key, "Txx")`.

```
                    ┌──────────────────────────────────────┐
                    │  _search_fr_impl(row)                │
                    └──────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
     TIER0 / garde-fous         T1A / T1B / T2…T5          (voir ci-dessous)
```

### Schéma séquentiel des tiers

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ T0  Placeholder : nom type AVANCE + pas SIRET + pas CP → NOT_FOUND       │
  └─────────────────────────────────────────────────────────────────────────┘
                                      │ sinon
                                      ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ T1A  GET /siret/{14}              → si actif (A) → TIER1A_VALIDATED      │
  │      sinon log SIRET_INACTIVE, continue                                  │
  └─────────────────────────────────────────────────────────────────────────┘
                                      │ sinon match
                                      ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ T1B  GET siren:{9} nombre=50        → _pick_t1b → TIER1B_SIREN            │
  └─────────────────────────────────────────────────────────────────────────┘
                                      │ sinon
                                      ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ T2   build_name_query + CP exact    → q + AND codePostalEtablissement:cp │
  │      nombre=20 → _pick_t2 → TIER2_POSTAL                                 │
  └─────────────────────────────────────────────────────────────────────────┘
                                      │ sinon
                                      ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ T3   même nq + département          → codePostalEtablissement:dept*    │
  │      nombre=50 → _pick_t3 → TIER3_DEPT                                   │
  └─────────────────────────────────────────────────────────────────────────┘
                                      │ sinon
                                      ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ T4   _tier4(row, sn, cp)  → Gemini + INSEE (voir section dédiée)         │
  └─────────────────────────────────────────────────────────────────────────┘
                                      │ sinon
                                      ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ T5   GET q=nom seul nombre=50       → _pick_t5 → TIER5_NAME_ONLY         │
  └─────────────────────────────────────────────────────────────────────────┘
                                      │ sinon
                                      ▼
                              NOT_FOUND
```

### Sélection de candidats (sans score pondéré)

| Tier | Fonction | Idée |
|------|----------|------|
| T1B | `_pick_t1b` | Actif > siège > CP exact > même département |
| T2 | `_pick_t2` | Aligné CP / département |
| T3 | `_pick_t3` | Priorité même département |
| T5 | `_pick_t5` | Actif puis siège |

Normalisation sortie établissement : `_norm_etab`.

---

## Tier 4 FR — Gemini + INSEE (`_tier4`)

**Fichier** : `enrich_suppliers.py` — fonction `_tier4`.

### Étape A — Identification (1 prompt)

**Cache** `_gemini` : clé MD5 `fr_ident|sn|city|addr` via `_ghash`.

**Appel** : `_gemini_call(prompt, ck)` → `_init_gemini()` → modèle `gemini-2.5-flash` → `_parse_gemini`.

**Prompt (texte exact du code)** :

```
Find the French legal name for this company:
Company: {sn}
Address: {addr}
City: {city}

Return ONLY JSON: {"candidate_legal_name":"...","candidate_siren":"9-digit or null","confidence":"high|medium|low","notes":"..."}
Do not invent identifiers. Infer from the provided fields only. Do not claim external verification.
```

**Ensuite** (ordre logique) :

1. Si SIREN 9 chiffres valide → `GET .../siret?q=siren:{cs}&nombre=50` (tier log `T4-SIREN`) → `_pick_t1b` → `TIER4_GEMINI`.
2. Sinon si `candidate_legal_name` → `build_name_query` + filtre département → `T4-NAME` → `_pick_t3` → `TIER4_GEMINI`.

### Étape B — « détective » (2ᵉ prompt)

Si l’étape A n’a pas abouti.

**Cache** : `_ghash("fr_det", sn, city, cp)`.

**Prompt (texte exact du code)** :

```
You are an expert on the INSEE Sirene database.
Company: "{sn}", City: "{city}", CP: "{cp}"
Rules: legal forms (SARL,SAS…) not in denomination, locations usually excluded, apostrophes vary.
Return ONLY JSON: {"primaryName":"MOST LIKELY NAME","alternativeNames":["VAR1","VAR2"],"confidence":"high|medium|low","reasoning":"..."}
Do not claim external verification.
```

**Ensuite** : jusqu’à 3 variantes (`primaryName` + `alternativeNames`) → `build_name_query` + département → `GET` avec tier `T4-DET` → `_pick_t3` → `TIER4_GEMINI`.

---

## Gemini — FR hors Tier 4 (`_gemini_call`)

| Étape | Fonction | Notes |
|--------|----------|--------|
| Cache | `_c_gemini[cache_key]` | |
| Throttle | `_throttle_gemini()` | `GEMINI_CALLS_PER_MINUTE` (défaut 300/min) |
| Appel | `model.generate_content(prompt)` | |
| Parse | `_parse_gemini` | fences \`\`\`json, ou premier `{...}` |
| 429 | sleep 10s + retry une fois | |

---

## Pipeline NON-FR — `enrich_nonfr` → `_enrich_nonfr_impl`

**Fichier** : `enrich_suppliers.py`.

```
  _heuristic_flags(row)
  _looks_like_advance_placeholder(sn)  → SKIPPED_ADVANCE
  adresse+CP+ville tous vides            → SKIPPED_NO_DATA
  _init_gemini()                         → pas de clé → GEMINI_API_ERROR
  full_prompt = _SYSTEM_NONFR + "\n\n" + _nonfr_user_prompt(row, flags)
  generate_content(full_prompt)        → _parse_gemini
```

### Prompt système NON-FR (`_SYSTEM_NONFR`)

```
You are an expert international business address verification assistant.
Your task is to analyze supplier data from  ERP export and return
a corrected, standardized record based only on the information provided.

Rules:
- Use all provided fields together as context clues.
- Keep existing data that seems correct; only fix what is clearly wrong or missing.
- Correct typos, bad casing, concatenated fields, city/country mixtures, and truncated names only when strongly justified.
- Infer missing data only when it is strongly supported by the row.
- If a field is genuinely unknown, keep it empty.
- Never invent data.
- Return only a valid JSON object, no explanation, no markdown.
```

### Prompt utilisateur NON-FR (`_nonfr_user_prompt`)

Structure (template avec champs interpolés) :

```
Normalize this NON-FRENCH supplier record conservatively.

Supplier row:
- Short name (Libellé abrégé): {lib}
- Full name (Nom): {nom}
- Country code (raw): {pays}
- Legal form: {forme}

Raw address fields:
- Address 1: {a1}
- Address 2: {a2}
- Address 3: {a3}
- Postal code: {cp}
- City: {vi}

Derived helpers:
- Search name: {sn}
- Search address: {sa}
- Heuristic flags: {fl}

Instructions:
- No external verification claims; no invented address data.
- Keep local postal code formats; corrected country code ISO alpha-3 when possible.
- Return JSON only with exactly:
{
  "corrected_name": "",
  "corrected_address1": "",
  "corrected_address2": "",
  "corrected_address3": "",
  "corrected_postal_code": "",
  "corrected_city": "",
  "corrected_country_code": "",
  "confidence": "HIGH|MEDIUM|LOW",
  "correction_notes": "",
  "review_flags": []
}
```

**Note** : le Tier 4 FR utilise `_gemini_call` ; le **NON-FR** appelle `generate_content` **directement** sur `full_prompt` (pas `_gemini_call`), avec cache `_c_gemini` sur la même clé `_ghash("nonfr", ...)`.

---

## Récapitulatif des prompts Gemini

| Contexte | Variable / fonction | Contenu |
|----------|---------------------|---------|
| FR T4 — identification | `prompt` dans `_tier4` | « Find the French legal name… » + JSON candidate_legal_name / candidate_siren |
| FR T4 — détective | `prompt2` dans `_tier4` | Expert INSEE + primaryName / alternativeNames |
| NON-FR | `_SYSTEM_NONFR` + `_nonfr_user_prompt` | Normalisation adresse + schéma JSON corrigé |

---

## Sortie et CLI (`main`)

| Élément | Détail |
|---------|--------|
| Construction ligne | `_build_row(row, fr_dict \| None, nf_dict \| None)` |
| Ordre colonnes | `ALL_COLS` |
| CSV | `sep=';'`, `encoding='utf-8-sig'` |
| Nom fichier | `enriched_suppliers_{timestamp}.csv` à côté du `.xlsx` |
| Progression stderr | `ProgressTracker.emit` — barre, % phase, % global, ETA, lignes/min |

---

## Caches en mémoire

| Cache | Clé | Contenu |
|-------|-----|---------|
| `_c_insee` | URL complète | JSON réponse INSEE (succès non-404) |
| `_c_gemini` | MD5 (`_ghash`) ou clé nonfr | dict parsé |

---

## Variables d’environnement utiles

| Variable | Rôle |
|----------|------|
| `VITE_INSEE_API_KEY` … `VITE_INSEE_API_KEY10` | Clés INSEE (dictionnaire 1–10 dans `insee_key_rotator.py`) |
| `INSEE_GLOBAL_CALLS_PER_MINUTE` | Défaut 290 — throttle global INSEE |
| `VITE_API_BASE_URL` | Base API Sirene v3.11 |
| `VITE_GEMINI_API_KEY` | Gemini |
| `GEMINI_CALLS_PER_MINUTE` | Défaut 300 — throttle `_throttle_gemini` |
| `LOG_API_CALLS=1` | Logs détaillés INSEE / Gemini sur stderr |

---

## Dépendances Python (principales)

`pandas`, `openpyxl`, `requests`, `python-dotenv`, `google-generativeai` (pour Gemini à l’exécution).

---

*Document aligné sur le code des fichiers `enrich_suppliers.py` et `insee_key_rotator.py` du dépôt.*
