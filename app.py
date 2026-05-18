"""
app.py — Flask web application for MMPA Analysis
"""

import json
import os
import uuid
import base64

from flask import (
    Flask, render_template, request, jsonify,
    session, redirect, url_for
)

from mmpa_logic import (
    run_sar_split,
    run_mmpa,
    mol_to_image_b64,
    mol_to_3d_sdf,
    mol_to_3d_colored_parts,
    normalize_smiles_for_3d,
)

app = Flask(__name__)
app.secret_key = os.urandom(24)

# Disable static file caching in debug mode so JS/CSS are always fresh
@app.after_request
def add_no_cache(response):
    if app.debug:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# In-memory result store keyed by session token
_store: dict = {}


# =========================================================
# HELPERS
# =========================================================

def _get_session_id() -> str:
    if "sid" not in session:
        session["sid"] = str(uuid.uuid4())
    return session["sid"]


def _store_set(sid: str, key: str, value):
    if sid not in _store:
        _store[sid] = {}
    _store[sid][key] = value


def _store_get(sid: str, key: str, default=None):
    return _store.get(sid, {}).get(key, default)


def _build_sar_part_examples(result: dict, scaffold_smiles: str) -> list:
    examples = []
    seen = set()
    for row in result["results"]:
        if row["scaffold"] != scaffold_smiles or not row.get("full_smiles"):
            continue
        key = (row["full_smiles"], row["transformation"], row.get("compound_id", ""))
        if key in seen:
            continue
        seen.add(key)
        examples.append({
            "smiles": row["full_smiles"],
            "highlight_smiles": scaffold_smiles,
            "transformation": row["transformation"],
            "label": row["transformation"] if row["transformation"] != "None" else "Scaffold only",
            "compound_id": row.get("compound_id", ""),
        })
    return examples


def _build_mmpa_part_examples(result: dict, core_smiles: str) -> list:
    examples = []
    seen = set()
    for pair in result["pairs"]:
        if pair["Core"] != core_smiles:
            continue

        out_key = (pair.get("Smiles_A", ""), pair["Fragment_Out"], pair.get("Compound_A", ""))
        if out_key not in seen and pair.get("Smiles_A"):
            seen.add(out_key)
            examples.append({
                "smiles": pair["Smiles_A"],
                "highlight_smiles": core_smiles,
                "transformation": pair["Transformation"],
                "label": f"Out: {pair['Fragment_Out']}",
                "compound_id": pair.get("Compound_A", ""),
            })

        in_key = (pair.get("Smiles_B", ""), pair["Fragment_In"], pair.get("Compound_B", ""))
        if in_key not in seen and pair.get("Smiles_B"):
            seen.add(in_key)
            examples.append({
                "smiles": pair["Smiles_B"],
                "highlight_smiles": core_smiles,
                "transformation": pair["Transformation"],
                "label": f"In: {pair['Fragment_In']}",
                "compound_id": pair.get("Compound_B", ""),
            })

    return examples


# =========================================================
# ROUTES
# =========================================================

@app.route("/", methods=["GET"])
def index():
    sid = _get_session_id()
    uploaded_filename = _store_get(sid, "filename")
    return render_template("index.html", uploaded_filename=uploaded_filename)


@app.route("/upload", methods=["POST"])
def upload():
    sid = _get_session_id()

    if "json_file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    f = request.files["json_file"]
    if f.filename == "":
        return jsonify({"error": "No file selected"}), 400

    try:
        raw = f.read().decode("utf-8")
        data = json.loads(raw)
    except Exception as e:
        return jsonify({"error": f"Invalid JSON: {e}"}), 400

    _store_set(sid, "data", data)
    _store_set(sid, "filename", f.filename)

    return jsonify({
        "success": True,
        "filename": f.filename,
        "entries": len(data),
    })


@app.route("/run/sar_split", methods=["POST"])
def run_sar():
    sid = _get_session_id()
    data = _store_get(sid, "data")
    if data is None:
        return jsonify({"error": "No data uploaded"}), 400

    result = run_sar_split(data)
    _store_set(sid, "sar_result", result)

    # Build scaffold rows with 2D image
    scaffold_rows = []
    for sc in result["unique_scaffolds"]:
        img_b64 = mol_to_image_b64(sc, size=(250, 170))
        compounds = result["scaffold_map"].get(sc, [])
        # find transformations for this scaffold from results
        transforms = list(set(
            r["transformation"]
            for r in result["results"]
            if r["scaffold"] == sc
        ))
        scaffold_rows.append({
            "smiles": sc,
            "image": img_b64,
            "compound_count": len(set(compounds)),
            "transformations": transforms,
            "example_smiles": next(
                (
                    r["full_smiles"]
                    for r in result["results"]
                    if r["scaffold"] == sc and r.get("full_smiles")
                ),
                "",
            ),
            "part_examples": _build_sar_part_examples(result, sc),
        })

    return jsonify({
        "mode": "sar_split",
        "total_entries": result["total_entries"],
        "unique_scaffold_count": len(result["unique_scaffolds"]),
        "unique_transformation_count": len(result["unique_transformations"]),
        "scaffolds": scaffold_rows,
    })


@app.route("/run/mmpa", methods=["POST"])
def run_mmp():
    sid = _get_session_id()
    data = _store_get(sid, "data")
    if data is None:
        return jsonify({"error": "No data uploaded"}), 400

    result = run_mmpa(data)
    _store_set(sid, "mmpa_result", result)

    # Build per-core pair counts
    pairs_list = result["pairs"]
    core_pair_counts: dict = {}
    for p in pairs_list:
        core_pair_counts[p["Core"]] = core_pair_counts.get(p["Core"], 0) + 1

    # Build core rows with 2D image
    core_rows = []
    for core_smiles in result["unique_cores"]:
        img_b64 = mol_to_image_b64(core_smiles, size=(250, 170))
        transforms = result["core_transformations"].get(core_smiles, [])
        part_examples = _build_mmpa_part_examples(result, core_smiles)
        core_rows.append({
            "smiles": core_smiles,
            "image": img_b64,
            "pair_count": core_pair_counts.get(core_smiles, 0),
            "transformation_count": len(transforms),
            "transformations": transforms,
            "example_smiles": result.get("core_examples", {}).get(core_smiles, ""),
            "part_examples": part_examples,
            "part_examples_count": len(part_examples),
        })

    return jsonify({
        "mode": "mmpa",
        "unique_core_count": len(result["unique_cores"]),
        "unique_transformation_count": len(result["unique_transformations"]),
        "total_pairs": len(result["pairs"]),
        "cores": core_rows,
        "transform_summary": result["transform_summary"][:50],  # top 50
    })


@app.route("/api/mol_image")
def mol_image():
    smiles = request.args.get("smiles", "")
    w = int(request.args.get("w", 300))
    h = int(request.args.get("h", 200))
    b64 = mol_to_image_b64(smiles, size=(w, h))
    return jsonify({"image": b64})


@app.route("/api/mol_3d")
def mol_3d():
    smiles = request.args.get("smiles", "")
    highlight = request.args.get("highlight", "")
    if highlight:
        colored = mol_to_3d_colored_parts(smiles, highlight)
        return jsonify({
            "sdf": colored["sdf"],
            "smiles": colored["smiles"],
            "highlight_smiles": colored["highlight_smiles"],
            "part_a_atoms": colored["part_a_atoms"],
            "part_b_atoms": colored["part_b_atoms"],
        })

    sdf = mol_to_3d_sdf(smiles)
    return jsonify({"sdf": sdf, "smiles": normalize_smiles_for_3d(smiles)})


@app.route("/api/pairs_for_core")
def pairs_for_core():
    sid = _get_session_id()
    core_smiles = request.args.get("core", "")
    mmpa_result = _store_get(sid, "mmpa_result")
    if mmpa_result is None:
        return jsonify({"error": "No MMPA result"}), 400

    pairs = [p for p in mmpa_result["pairs"] if p["Core"] == core_smiles]
    return jsonify({"pairs": pairs, "count": len(pairs)})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
