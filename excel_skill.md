# excel_skill.md

## 🧠 Skill Name
generate_clean_styled_excel

---

## 🎯 Purpose

Transform one or more CSV datasets into a production-ready Excel (.xlsx) file with:
- Clean structure
- Consistent styling
- No corruption issues
- Clear business readability
- Built-in comparison (changes tracking)

---

## 📥 Inputs

- source_old.csv (optional)
- source_new.csv (mandatory)

Constraints:
- UTF-8 encoding
- Flat tabular structure
- Same schema preferred

---

## 📤 Output

styled_output.xlsx

Sheets:
1. Overview
2. Data_New
3. Data_Old
4. Changes

---

## ⚙️ Core Processing Logic

### Load Data
- Read CSVs
- Normalize headers (trim, consistent casing)
- Align schemas

---

### Change Detection

Define primary key (first column if not specified)

For each row:
IF exists in both:
    FOR each column:
        IF old != new:
            record change

Output: one row per changed field

---

## 📊 Sheets

### Overview
Columns:
Metric | Value

Include:
- Total rows (new)
- Total rows (old)
- Changed rows count
- % change
- Count per FR_Status
- Count per AI_Status

---

### Data_New
- Full enriched dataset
- Styled

---

### Data_Old
- Original dataset
- Same structure

---

### Changes
Columns:
Key | Field | Old Value | New Value | FR_Status | AI_Status

---

## 🎨 Styling Rules

### Global
- DO NOT use Excel Tables
- Use plain ranges
- Apply filters manually
- Freeze header row
- Auto-fit columns

---

### Rows
- Always white / neutral
- No zebra
- No colored rows

---

### Columns

FR_* → light green (soft)
AI_* → light blue
Others → white

---

### Status Colors

FR_Status:
- TIER1A_VALIDATED → dark green
- TIER1B_SIREN → light green
- TIER2_POSTAL → yellow
- TIER3_DEPT → orange
- TIER4_GEMINI → dark orange
- TIER5_NAME_ONLY → red
- NOT_FOUND → dark grey

AI_Status:
- GEMINI_CORRECTED → light blue
- SKIPPED_ADVANCE → grey
- SKIPPED_NO_DATA → pale yellow

---

### Changes Sheet

- Rows remain white
- Old Value → light red
- New Value → light green
- Status cells keep their colors

---

## 🧠 AI Notes Handling

If AI_Notes + AI_Confidence exist:

- Remove AI_Notes column
- Add comment to column A

Format:
[Confidence: <AI_Confidence>]
<AI_Notes>

---

## 🔧 Excel Mechanics

DO NOT:
ws.add_table()

USE:
ws.auto_filter.ref = "A1:Z1000"
ws.freeze_panes = "A2"

---

## 🧪 Validation Checklist

- No Excel repair warning
- Filters working
- No tables
- No colored rows
- Proper column tinting
- Correct status coloring
- Comments present
- Changes accurate

---

## 🧱 Implementation (Python)

Libraries:
- pandas
- openpyxl

Use:
- PatternFill
- Comment
- auto_filter
- freeze_panes

---

## 🚫 Avoid

- Excel Tables
- Row coloring
- Inconsistent styles
- Missing comments
- Broken filters

---

## ✅ Output Guarantee

- Opens without warning
- Clean and readable
- Business-ready
- Clear differences

---

## 🧠 Principle

Clarity over decoration  
Structure over styling  
Reliability over complexity