"""
mmpa_logic.py
Refactored MMPA analysis functions extracted from mmpa_simple.py
and mmpa_windowsapp.py for use by the Flask web application.
"""

import json
import io
import base64
from collections import defaultdict

import pandas as pd
from rdkit import Chem
from rdkit.Chem import Draw, AllChem, Descriptors
from rdkit.Chem.Scaffolds import MurckoScaffold
from rdkit.Chem import rdMMPA, rdFMCS


# =========================================================
# SHARED UTILITIES
# =========================================================

MAX_FRAGMENT_SIZE = 18
MIN_CORE_SIZE = 4


def mol_to_image_b64(smiles: str, size=(300, 200)) -> str:
    """Return a base64-encoded PNG of the 2D molecule drawing."""
    try:
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return ""
        img = Draw.MolToImage(mol, size=size)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception:
        return ""


def _strip_dummy_atoms(mol: Chem.Mol):
    """Remove attachment-point dummy atoms such as [*:1] from a molecule."""
    try:
        rw_mol = Chem.RWMol(mol)
        dummy_indices = [
            atom.GetIdx()
            for atom in rw_mol.GetAtoms()
            if atom.GetAtomicNum() == 0
        ]
        for idx in sorted(dummy_indices, reverse=True):
            rw_mol.RemoveAtom(idx)
        cleaned = rw_mol.GetMol()
        Chem.SanitizeMol(cleaned)
        return cleaned
    except Exception:
        return None


def _prepare_mol_for_3d(smiles: str):
    """Parse SMILES and remove dummy atoms so the result can be embedded in 3D."""
    try:
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None, ""

        if any(atom.GetAtomicNum() == 0 for atom in mol.GetAtoms()):
            mol = _strip_dummy_atoms(mol)
            if mol is None:
                return None, ""

        normalized_smiles = Chem.MolToSmiles(mol)
        return mol, normalized_smiles
    except Exception:
        return None, ""


def normalize_smiles_for_3d(smiles: str) -> str:
    """Return a drawable SMILES string with dummy atoms removed when needed."""
    _, normalized_smiles = _prepare_mol_for_3d(smiles)
    return normalized_smiles


def _mol_to_3d_block(mol: Chem.Mol) -> str:
    """Embed a molecule in 3D and return a mol block."""
    mol_3d = Chem.AddHs(Chem.Mol(mol))
    result = AllChem.EmbedMolecule(mol_3d, AllChem.ETKDGv3())
    if result != 0:
        result = AllChem.EmbedMolecule(mol_3d, randomSeed=42)
        if result != 0:
            return ""
    try:
        AllChem.MMFFOptimizeMolecule(mol_3d)
    except Exception:
        pass
    mol_3d = Chem.RemoveHs(mol_3d)
    return Chem.MolToMolBlock(mol_3d)


def _find_highlight_match(mol: Chem.Mol, sub: Chem.Mol):
    """Find atom indices for the highlighted part in a full molecule."""
    match = mol.GetSubstructMatch(sub)
    if match:
        return match

    match = mol.GetSubstructMatch(sub, useChirality=False)
    if match:
        return match

    try:
        mcs = rdFMCS.FindMCS(
            [mol, sub],
            timeout=5,
            ringMatchesRingOnly=True,
            completeRingsOnly=True,
        )
        if mcs.canceled or not mcs.smartsString:
            return ()
        query = Chem.MolFromSmarts(mcs.smartsString)
        if query is None:
            return ()
        return mol.GetSubstructMatch(query)
    except Exception:
        return ()


def mol_to_3d_sdf(smiles: str) -> str:
    """Generate a 3D conformer and return the molecule as an SDF string."""
    try:
        mol, _ = _prepare_mol_for_3d(smiles)
        if mol is None:
            return ""
        return _mol_to_3d_block(mol)
    except Exception:
        return ""


def mol_to_3d_colored_parts(smiles: str, substructure_smiles: str) -> dict:
    """Return 3D SDF plus atom partitions for an intact molecule colored by substructure."""
    try:
        mol, normalized_smiles = _prepare_mol_for_3d(smiles)
        sub, normalized_substructure = _prepare_mol_for_3d(substructure_smiles)
        if mol is None or sub is None:
            return {
                "sdf": "",
                "part_a_atoms": [],
                "part_b_atoms": [],
                "smiles": normalized_smiles,
                "highlight_smiles": normalized_substructure,
            }

        match = _find_highlight_match(mol, sub)
        if not match:
            return {
                "sdf": "",
                "part_a_atoms": [],
                "part_b_atoms": [],
                "smiles": normalized_smiles,
                "highlight_smiles": normalized_substructure,
            }

        mol_block = _mol_to_3d_block(mol)
        if not mol_block:
            return {
                "sdf": "",
                "part_a_atoms": [],
                "part_b_atoms": [],
                "smiles": normalized_smiles,
                "highlight_smiles": normalized_substructure,
            }

        part_a_atoms = sorted(match)
        part_a_atom_set = set(part_a_atoms)
        part_b_atoms = sorted(
            idx for idx in range(mol.GetNumAtoms()) if idx not in part_a_atom_set
        )
        return {
            "sdf": mol_block,
            "part_a_atoms": part_a_atoms,
            "part_b_atoms": part_b_atoms,
            "smiles": normalized_smiles,
            "highlight_smiles": normalized_substructure,
        }
    except Exception:
        return {
            "sdf": "",
            "part_a_atoms": [],
            "part_b_atoms": [],
            "smiles": "",
            "highlight_smiles": "",
        }


def canon_smiles(smi: str):
    """Canonicalize a SMILES string, return None on failure."""
    try:
        mol = Chem.MolFromSmiles(smi)
        if mol is not None:
            return Chem.MolToSmiles(mol)
    except Exception:
        pass
    return None


# =========================================================
# SAR SPLIT (mmpa_simple logic)
# =========================================================

def run_sar_split(data: list) -> dict:
    """
    Run Bemis-Murcko scaffold extraction on each compound.

    Parameters
    ----------
    data : list of dicts from the JSON file

    Returns
    -------
    dict with keys:
        total_entries     : int
        unique_scaffolds  : list of scaffold SMILES strings
        unique_transformations : list of transformation SMILES strings
        results           : list of dicts per compound
        scaffold_map      : dict scaffold_smiles -> list of compound_ids
    """
    results = []
    all_scaffolds = []
    all_transformations = []
    scaffold_map = defaultdict(list)

    for entry in data:
        smiles = entry.get("canonical_smiles", "")
        if not smiles:
            continue
        # Handle salt/mixture: take the largest fragment
        smiles = max(smiles.split("."), key=len)
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            continue

        scaffold_mol = MurckoScaffold.GetScaffoldForMol(mol)
        scaffold_smiles = Chem.MolToSmiles(scaffold_mol)

        remnant = Chem.ReplaceCore(mol, scaffold_mol)
        transformation_smiles = Chem.MolToSmiles(remnant) if remnant else "None"

        all_scaffolds.append(scaffold_smiles)
        all_transformations.append(transformation_smiles)
        scaffold_map[scaffold_smiles].append(entry.get("compound_chembl_id", ""))

        results.append({
            "compound_id": entry.get("compound_chembl_id", ""),
            "scaffold": scaffold_smiles,
            "transformation": transformation_smiles,
            "potency": entry.get("standard_value", ""),
            "units": entry.get("standard_units", ""),
            "full_smiles": smiles,
        })

    unique_scaffolds = sorted(list(set(all_scaffolds)))
    unique_transformations = sorted(list(set(all_transformations)))

    return {
        "total_entries": len(data),
        "unique_scaffolds": unique_scaffolds,
        "unique_transformations": unique_transformations,
        "results": results,
        "scaffold_map": dict(scaffold_map),
    }


# =========================================================
# MMP ANALYSIS (mmpa_windowsapp logic)
# =========================================================

def _split_cut(frag_smi: str):
    """
    Split an rdMMPA fragment string into (variable_fragment, conserved_core).
    Returns (None, None) if the cut is invalid.
    """
    parts = frag_smi.split(".")
    if len(parts) != 2:
        return None, None
    try:
        m0 = Chem.MolFromSmiles(parts[0])
        m1 = Chem.MolFromSmiles(parts[1])
        if m0 is None or m1 is None:
            return None, None
        n0 = m0.GetNumHeavyAtoms()
        n1 = m1.GetNumHeavyAtoms()
    except Exception:
        return None, None

    if n0 <= n1:
        fragment, core = parts[0], parts[1]
        f_atoms, c_atoms = n0, n1
    else:
        fragment, core = parts[1], parts[0]
        f_atoms, c_atoms = n1, n0

    if f_atoms > MAX_FRAGMENT_SIZE:
        return None, None
    if c_atoms < MIN_CORE_SIZE:
        return None, None

    return canon_smiles(fragment), canon_smiles(core)


def run_mmpa(data: list) -> dict:
    """
    Run full Matched Molecular Pair Analysis.

    Parameters
    ----------
    data : list of dicts from the JSON file

    Returns
    -------
    dict with keys:
        unique_cores         : list of core SMILES
        unique_transformations : list of transformation strings
        pairs                : list of pair dicts
        transform_summary    : list of dicts with aggregated stats
        core_transformations : dict core_smiles -> list of transformation strings
    """
    df = pd.DataFrame(data)

    df["standard_value"] = pd.to_numeric(df["standard_value"], errors="coerce")
    df = df.dropna(subset=["canonical_smiles", "standard_value"])
    df = df[df["standard_type"] == "IC50"].copy()

    # Handle salts: take largest fragment
    df["canonical_smiles"] = df["canonical_smiles"].apply(
        lambda s: max(s.split("."), key=len) if isinstance(s, str) else s
    )

    df["mol"] = df["canonical_smiles"].apply(Chem.MolFromSmiles)
    df = df[df["mol"].notnull()].copy()

    # Build core index
    core_index = defaultdict(list)

    for idx, row in df.iterrows():
        mol = row["mol"]
        try:
            cuts = rdMMPA.FragmentMol(mol, maxCuts=1, resultsAsMols=False)
        except Exception:
            continue

        seen = set()
        for _, frag_smi in cuts:
            fragment, core = _split_cut(frag_smi)
            if fragment is None:
                continue
            key = (core, fragment)
            if key in seen:
                continue
            seen.add(key)

            core_index[core].append({
                "compound_id": row.get("compound_chembl_id", ""),
                "smiles": row["canonical_smiles"],
                "activity": float(row["standard_value"]),
                "target": row.get("target_name", ""),
                "units": row.get("standard_units", ""),
                "fragment": fragment,
                "mw": round(Descriptors.MolWt(mol), 2),
            })

    # Generate matched pairs
    pairs = []
    for core, members in core_index.items():
        if len(members) < 2:
            continue
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                a = members[i]
                b = members[j]
                if a["fragment"] == b["fragment"]:
                    continue
                delta_activity = b["activity"] - a["activity"]
                delta_mw = b["mw"] - a["mw"]
                transformation = f"{a['fragment']} >> {b['fragment']}"
                pairs.append({
                    "Core": core,
                    "Fragment_Out": a["fragment"],
                    "Fragment_In": b["fragment"],
                    "Transformation": transformation,
                    "Compound_A": a["compound_id"],
                    "Compound_B": b["compound_id"],
                    "Smiles_A": a["smiles"],
                    "Smiles_B": b["smiles"],
                    "Activity_A": a["activity"],
                    "Activity_B": b["activity"],
                    "Delta_Activity": round(delta_activity, 2),
                    "Delta_MW": round(delta_mw, 2),
                    "Target": a["target"],
                    "Units": a["units"],
                })

    if not pairs:
        return {
            "unique_cores": [],
            "unique_transformations": [],
            "pairs": [],
            "transform_summary": [],
            "core_transformations": {},
        }

    pairs_df = pd.DataFrame(pairs)
    pairs_df = pairs_df.drop_duplicates(
        subset=["Core", "Fragment_Out", "Fragment_In", "Compound_A", "Compound_B"]
    )

    unique_cores = pairs_df["Core"].drop_duplicates().tolist()
    unique_transformations = pairs_df["Transformation"].drop_duplicates().tolist()
    core_examples = {
        core: members[0]["smiles"]
        for core, members in core_index.items()
        if members
    }

    transform_summary = (
        pairs_df.groupby(["Fragment_Out", "Fragment_In", "Transformation"], as_index=False)
        .agg(
            Pair_Count=("Delta_Activity", "count"),
            Mean_Delta_Activity=("Delta_Activity", "mean"),
            Min_Delta_Activity=("Delta_Activity", "min"),
            Max_Delta_Activity=("Delta_Activity", "max"),
            Mean_Delta_MW=("Delta_MW", "mean"),
        )
        .round(2)
        .sort_values("Mean_Delta_Activity")
    )

    # Map each core to its transformations
    core_transformations = (
        pairs_df.groupby("Core")["Transformation"]
        .apply(lambda x: list(x.unique()))
        .to_dict()
    )

    return {
        "unique_cores": unique_cores,
        "unique_transformations": unique_transformations,
        "pairs": pairs_df.to_dict(orient="records"),
        "transform_summary": transform_summary.to_dict(orient="records"),
        "core_transformations": core_transformations,
        "core_examples": core_examples,
    }
