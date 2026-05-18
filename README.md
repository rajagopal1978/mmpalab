# MMPA Analysis Package

This package is a small Flask-based web application for exploring Structure-Activity Relationship (SAR) data with:

- Bemis-Murcko scaffold splitting
- Matched Molecular Pair Analysis (MMPA)
- 2D molecule rendering
- 3D molecule visualization
- colored 3D part highlighting for scaffold/core vs remaining atoms

It is designed for medicinal chemistry workflows where you want to upload a JSON dataset of compounds, group compounds by scaffold or conserved core, and inspect transformations visually.

## What This Package Does

After uploading a JSON file containing compound data, the app provides two analysis modes:

1. `SAR Split`
   - extracts Bemis-Murcko scaffolds from each molecule
   - groups compounds by shared scaffold
   - shows scaffold-level transformations

2. `MMP Analysis`
   - performs matched molecular pair fragmentation using RDKit `rdMMPA`
   - finds conserved cores and fragment changes between related compounds
   - summarizes transformations and pairwise activity changes

The UI then lets you inspect:

- 2D depictions of scaffolds or cores
- a standard 3D view of the selected structure
- a `View 3D Parts` mode showing the intact molecule with two colors:
  - scaffold/core atoms
  - remaining atoms

## Main Files

- [app.py](c:\work\MMPA_Analysis\app.py)
  Flask application entry point. Handles upload, analysis routes, molecule image/3D APIs, and session-backed in-memory result storage.

- [mmpa_logic.py](c:\work\MMPA_Analysis\mmpa_logic.py)
  Core chemistry logic. Contains:
  - 2D image generation
  - 3D conformer generation
  - dummy atom cleanup for 3D rendering
  - SAR scaffold extraction
  - MMPA processing and transformation summaries

- [templates/index.html](c:\work\MMPA_Analysis\templates\index.html)
  Main web page template.

- [static/js/main.js](c:\work\MMPA_Analysis\static\js\main.js)
  Frontend behavior for upload, analysis runs, result tables, transformations popup, and 3D viewer interactions.

- [static/css/style.css](c:\work\MMPA_Analysis\static\css\style.css)
  Application styling.

- [topoisomere_2_alpha_SAR.json](c:\work\MMPA_Analysis\topoisomere_2_alpha_SAR.json)
  Example SAR dataset included in the repository.

- [mmpa_simple.py](c:\work\MMPA_Analysis\mmpa_simple.py)
  Older or standalone SAR-related logic reference.

- [mmpa_windowsapp.py](c:\work\MMPA_Analysis\mmpa_windowsapp.py)
  Earlier Windows-oriented script version used as a source for refactoring.

## Request Flow

### 1. Upload

The browser sends a JSON file to:

- `POST /upload`

The uploaded dataset is stored in memory per session.

### 2. Run Analysis

The user chooses one of:

- `POST /run/sar_split`
- `POST /run/mmpa`

These routes call:

- `run_sar_split(data)`
- `run_mmpa(data)`

and return processed rows for the UI.

### 3. Visualize Molecules

For 2D drawings:

- `GET /api/mol_image`

For 3D structures:

- `GET /api/mol_3d`

The 3D endpoint supports:

- plain rendering of a molecule
- highlighted rendering of an intact molecule using a scaffold/core substructure

Before 3D generation, the backend now removes dummy attachment atoms like `[*:1]` so RDKit can embed and optimize the molecule safely.

## 3D Rendering Notes

The app uses `3Dmol.js` in the browser and RDKit on the backend:

- RDKit generates the 3D conformer as SDF
- `3Dmol.js` renders the SDF interactively
- the frontend supports multiple display styles such as stick, sphere, line, cross, and cartoon
- when `View 3D Parts` is used, the backend returns atom indices for two regions and the frontend colors them separately

This is especially useful for seeing how a conserved scaffold/core sits inside the full unsplit molecule.

## Input Data Expectations

The uploaded JSON should be a list of objects. The current code expects fields such as:

- `canonical_smiles`
- `compound_chembl_id`
- `standard_value`
- `standard_units`
- `standard_type`
- `target_name`

For MMPA mode, the code specifically filters for:

- numeric `standard_value`
- non-null `canonical_smiles`
- `standard_type == "IC50"`

## Key Implementation Details

- Salt or mixture SMILES are simplified by taking the largest fragment.
- For 3D rendering, dummy atoms used in split/query SMILES are stripped before conformer generation.
- SAR mode stores one representative full molecule per scaffold so the intact structure can be shown in `View 3D Parts`.
- MMPA mode stores one representative full molecule per conserved core for the same reason.
- Results are stored in a simple in-memory Python dictionary keyed by Flask session ID.

## How To Run

Install the required Python packages first. At minimum, this project needs:

- `flask`
- `pandas`
- `rdkit`

Then run:

```powershell
python .\app.py
```

By default, the Flask app starts on:

```text
http://127.0.0.1:5000
```

Open that URL in your browser, upload a dataset, and choose an analysis mode.

## Current Limitations

- No persistent database; results are stored only in memory.
- No authentication or multi-user storage isolation beyond the session key.
- Very large datasets may be slower because analysis is computed in-process.
- Dependency installation is not documented in a pinned `requirements.txt` yet.

## Summary

This package is a lightweight medicinal chemistry analysis UI built on Flask and RDKit. It helps you move from raw SAR JSON data to scaffold/core grouping, transformation summaries, and interactive 2D/3D molecular inspection with minimal setup.
