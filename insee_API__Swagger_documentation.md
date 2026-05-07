# INSEE API Sirene Documentation (Detailed)

This document provides a highly comprehensive reference for the INSEE API (Sirene), fully detailing the data models, exact object parameters, and multi-criteria queries.

## 1. Core Data Models

The following sections define the exact JSON object schemas returned by the API.

### 1.1 `Etablissement` (Establishment)
Represents a specific physical location of a business.

| Property | Type | Description |
| :--- | :--- | :--- |
| `siret` | `string` | **Unique Identifier** (14 digits). Always present. |
| `siren` | `string` | 9-digit ID of the parent company (`UniteLegale`). |
| `nic` | `string` | Internal classification number (5 digits). |
| `statutDiffusionEtablissement` | `string` | Diffusion status (e.g., "O" for Open). |
| `dateCreationEtablissement` | `string (date)` | Creation date (YYYY-MM-DD). |
| `trancheEffectifsEtablissement`| `string` | Employee size bracket. |
| `anneeEffectifsEtablissement` | `string` | Year of the employee bracket data. |
| `activitePrincipaleRegistreMetiersEtablissement` | `string` | APRM code (NAFA nomenclature). |
| `dateDernierTraitementEtablissement` | `string (datetime)`| Last update timestamp in Sirene. |
| `etablissementSiege` | `boolean` | `true` if this is the headquarters. |
| `nombrePeriodesEtablissement` | `integer` | Number of historical periods in its lifecyle. |
| `uniteLegale` | `object` | Embedded parameters of the parent company (see below). |
| `adresseEtablissement` | `Adresse object` | Primary address details (see below). |
| `adresse2Etablissement` | `Adresse object` | Secondary/Complementary address details. |
| `periodesEtablissement` | `array` | List of historical states (`PeriodeEtablissement`). |

### 1.2 `UniteLegale` (Legal Unit)
Represents the overarching legal entity (the "Enterprise").

| Property | Type | Description |
| :--- | :--- | :--- |
| `siren` | `string` | **Unique Identifier** (9 digits). |
| `statutDiffusionUniteLegale` | `string` | Diffusion status. |
| `unitePurgeeUniteLegale` | `boolean` | `true` if the unit has been purged. |
| `dateCreationUniteLegale` | `string (date)` | Creation date. |
| `categorieEntreprise` | `string` | PME, ETI, or GE (Small, Medium, or Large). |
| `anneeCategorieEntreprise` | `string` | Year for the category classification. |
| `denominationUniteLegale` | `string` | Legal name (for corporations). |
| `nomUniteLegale` | `string` | Birth name (for individuals). |
| `prenom1UniteLegale` | `string` | First name (for individuals). |
| `sigleUniteLegale` | `string` | Acronym/Abbreviation. |
| `etatAdministratifUniteLegale` | `string` | Status: `A` (active) or `C` (ceased). |
| `activitePrincipaleUniteLegale`| `string` | Main activity code (NAF). |
| `nomenclatureActivitePrincipaleUniteLegale` | `string` | Nomenclature version (e.g., `NAFRev2`). |
| `caractereEmployeurUniteLegale`| `string` | `O` (Yes) if it has employees. |
| `societeMissionUniteLegale` | `string` | Social/Environmental mission status. |
| `economieSocialeSolidaireUniteLegale` | `string` | ESS membership status. |

### 1.3 `Adresse` Structure
Standard address object used throughout the API.

| Property | Type | Description |
| :--- | :--- | :--- |
| `complementAdresseEtablissement` | `string` | Complementary address info (building, res). |
| `numeroVoieEtablissement` | `string` | Street number. |
| `indiceRepetitionEtablissement` | `string` | Repetition index (BIS, TER). |
| `typeVoieEtablissement` | `string` | Type of road (e.g., "RUE", "AVE"). |
| `libelleVoieEtablissement` | `string`| Name of the road. |
| `codePostalEtablissement` | `string` | 5-digit postal code. |
| `libelleCommuneEtablissement`| `string` | City/Commune name. |
| `codeCommuneEtablissement` | `string` | COG (Insee) commune code. |
| `codeCedexEtablissement` | `string` | Cedex number if applicable. |
| `codePaysEtrangerEtablissement`| `string` | Country code for foreign addresses. |

---

## 2. API Endpoints and Parameters

### 2.1 Search via Lucene Queries (`/siren` & `/siret`)

The multicriteria search endpoints handle complex business filtering. Both `GET` and `POST` methods parse identical query capabilities, but `POST` transmits complex filters inside the body to evade URL length constraints.

| Parameter | Req. | Type | Description |
| :--- | :--- | :--- | :--- |
| `q` | No | `string` | **Lucene Query**. E.g., `activitePrincipaleEtablissement:62.01Z AND codePostalEtablissement:75*`. Allows exact, partial `*`, and comparative matching. |
| `date` | No | `string` | Formatted `YYYY-MM-DD`. Validates data at a historic date (ignores retroactive name changes or moves). |
| `champs` | No | `string` | Comma-separated list to filter response structure (e.g., `siret,adresseEtablissement`). |
| `nombre` | No | `integer`| Items per page limits. Default: `20`. Standard Maximum: `1000`. |
| `debut` | No | `integer`| Standard pagination start index (used with `nombre`). Max allowed: `10000`. |
| `curseur` | No | `string` | Deep pagination key. If data exceeds 10,000 matches, use the `curseur` from the `header` for the next page instead of incrementing `debut`. |
| `tri` | No | `string` | Output sort. Format: `field asc` or `field desc`. Default sorting is ascending SIREN/SIRET. |
| `facette.champ` | No | `string` | Field over which analytical distributions are counted. |
| `masquerValeursNulles` | No | `boolean`| If true, omits properties whose values are `null` from the object payload minimizing JSON bloat. |

#### **GET /siren/{siren}** & **GET /siret/{siret}**
Targeting singular unit lookups. Rejects all parameter filtering except `date`, `champs`, and `masquerValeursNulles`. Always returns HTTP 200 containing the literal `uniteLegale` or `etablissement` object if found, or HTTP 404.

---

## 3. Standard Response Envelope

JSON payload wrappers are constant across all collection requests:

```json
{
  "header": {
    "statut": 200,
    "message": "OK",
    "total": 5283,
    "debut": 0,
    "nombre": 20,
    "curseur": "AoECAWA==",
    "curseurSuivant": "AoECBWB=="
  },
  "etablissements": [
    { ... } // Matches the Etablissement Model explicitly.
  ]
}
```

## Visual Exploration

The subagent successfully traversed the Swagger's "Schemas" block completely, expanding the complex entities deeply nested in the swagger configuration, and intercepting the direct REST objects. See recordings directly in the terminal memory.

````carousel
![Schemas Root Interaction](C:/Users/mouaad.ibnelaryf/.gemini/antigravity/brain/ce1e2371-024e-43af-af39-a044eae35fd4/.system_generated/click_feedback/click_feedback_1771824488558.png)
<!-- slide -->
![Deep property expansion (Adresse)](C:/Users/mouaad.ibnelaryf/.gemini/antigravity/brain/ce1e2371-024e-43af-af39-a044eae35fd4/.system_generated/click_feedback/click_feedback_1771824496104.png)
````

For a full session capture, reference:
[C:\Users\mouaad.ibnelaryf\.gemini\antigravity\brain\ce1e2371-024e-43af-af39-a044eae35fd4\insee_swagger_deep_dive_1771824472746.webp](file:///Users/mouaad.ibnelaryf/.gemini/antigravity/brain/ce1e2371-024e-43af-af39-a044eae35fd4/insee_swagger_deep_dive_1771824472746.webp)
