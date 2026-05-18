import json
from collections import defaultdict

import pandas as pd

from rdkit import Chem
from rdkit.Chem import rdMMPA
from rdkit.Chem import Descriptors

# ==========================================================
# CONFIG
# ==========================================================

INPUT_JSON = "topoisomere_2_alpha_SAR.json"

MAX_FRAGMENT_SIZE = 18
MIN_CORE_SIZE = 4

# ==========================================================
# LOAD DATA
# ==========================================================

with open(INPUT_JSON, "r") as f:
    data = json.load(f)

df = pd.DataFrame(data)

print(f"\nLoaded rows: {len(df)}")

# ==========================================================
# CLEAN DATA
# ==========================================================

df["standard_value"] = pd.to_numeric(
    df["standard_value"],
    errors="coerce"
)

df = df.dropna(subset=["canonical_smiles"])
df = df.dropna(subset=["standard_value"])

df = df[df["standard_type"] == "IC50"]

print(f"After cleanup: {len(df)}")

# ==========================================================
# CREATE MOLECULES
# ==========================================================

df["mol"] = df["canonical_smiles"].apply(
    Chem.MolFromSmiles
)

df = df[df["mol"].notnull()].copy()

print(f"Valid molecules: {len(df)}")

# ==========================================================
# CANONICALIZE SMILES
# ==========================================================

def canon_smiles(smi):

    try:

        mol = Chem.MolFromSmiles(smi)

        if mol is not None:
            return Chem.MolToSmiles(mol)

    except:
        pass

    return None

# ==========================================================
# SPLIT rdMMPA CUT
# ==========================================================

def split_cut(frag_smi):

    """
    rdMMPA maxCuts=1 returns:

    piece1.piece2

    We choose:
        smaller side  -> variable fragment
        larger side   -> conserved core
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

    except:
        return None, None

    # ------------------------------------------------------
    # SMALLER SIDE = FRAGMENT
    # LARGER SIDE  = CORE
    # ------------------------------------------------------

    if n0 <= n1:

        fragment = parts[0]
        core = parts[1]

        f_atoms = n0
        c_atoms = n1

    else:

        fragment = parts[1]
        core = parts[0]

        f_atoms = n1
        c_atoms = n0

    # ------------------------------------------------------
    # FILTER BAD CUTS
    # ------------------------------------------------------

    if f_atoms > MAX_FRAGMENT_SIZE:
        return None, None

    if c_atoms < MIN_CORE_SIZE:
        return None, None

    fragment = canon_smiles(fragment)
    core = canon_smiles(core)

    return fragment, core

# ==========================================================
# BUILD CORE INDEX
# ==========================================================

core_index = defaultdict(list)

print("\nGenerating MMP fragments...")

for idx, row in df.iterrows():

    mol = row["mol"]

    try:

        cuts = rdMMPA.FragmentMol(
            mol,
            maxCuts=1,
            resultsAsMols=False
        )

    except:
        continue

    seen = set()

    for _, frag_smi in cuts:

        fragment, core = split_cut(frag_smi)

        if fragment is None:
            continue

        key = (core, fragment)

        if key in seen:
            continue

        seen.add(key)

        core_index[core].append({

            "compound_id":
                row["compound_chembl_id"],

            "smiles":
                row["canonical_smiles"],

            "activity":
                float(row["standard_value"]),

            "target":
                row["target_name"],

            "units":
                row["standard_units"],

            "fragment":
                fragment,

            "mw":
                round(
                    Descriptors.MolWt(mol),
                    2
                )
        })

print(f"\nUnique conserved cores: {len(core_index)}")

# ==========================================================
# GENERATE MATCHED PAIRS
# ==========================================================

pairs = []

print("\nGenerating matched pairs...")

for core, members in core_index.items():

    if len(members) < 2:
        continue

    for i in range(len(members)):

        for j in range(i + 1, len(members)):

            a = members[i]
            b = members[j]

            # SAME FRAGMENT = NOT A TRANSFORMATION

            if a["fragment"] == b["fragment"]:
                continue

            delta_activity = (
                b["activity"] - a["activity"]
            )

            delta_mw = (
                b["mw"] - a["mw"]
            )

            transformation = (
                f"{a['fragment']} >> {b['fragment']}"
            )

            pairs.append({

                "Core":
                    core,

                "Fragment_Out":
                    a["fragment"],

                "Fragment_In":
                    b["fragment"],

                "Transformation":
                    transformation,

                "Compound_A":
                    a["compound_id"],

                "Compound_B":
                    b["compound_id"],

                "Activity_A":
                    a["activity"],

                "Activity_B":
                    b["activity"],

                "Delta_Activity":
                    round(delta_activity, 2),

                "Delta_MW":
                    round(delta_mw, 2),

                "Target":
                    a["target"],

                "Units":
                    a["units"]
            })

pairs_df = pd.DataFrame(pairs)

print(f"\nRaw matched pairs: {len(pairs_df)}")

# ==========================================================
# REMOVE DUPLICATES
# ==========================================================

pairs_df = pairs_df.drop_duplicates(

    subset=[

        "Core",
        "Fragment_Out",
        "Fragment_In",
        "Compound_A",
        "Compound_B"
    ]
)

print(f"After deduplication: {len(pairs_df)}")

# ==========================================================
# UNIQUE CONSERVED CORES
# ==========================================================

core_df = (
    pairs_df[["Core"]]
    .drop_duplicates()
)

print(f"\nUnique conserved cores: {len(core_df)}")

# ==========================================================
# UNIQUE TRANSFORMATIONS
# ==========================================================

transform_df = (
    pairs_df[["Transformation"]]
    .drop_duplicates()
)

print(f"Unique transformations: {len(transform_df)}")

# ==========================================================
# TRANSFORMATION STATISTICS
# ==========================================================

transform_summary = (

    pairs_df
    .groupby([

        "Fragment_Out",
        "Fragment_In",
        "Transformation"

    ], as_index=False)

    .agg(

        Pair_Count = (
            "Delta_Activity",
            "count"
        ),

        Mean_Delta_Activity = (
            "Delta_Activity",
            "mean"
        ),

        Min_Delta_Activity = (
            "Delta_Activity",
            "min"
        ),

        Max_Delta_Activity = (
            "Delta_Activity",
            "max"
        ),

        Mean_Delta_MW = (
            "Delta_MW",
            "mean"
        )
    )
)

transform_summary = (
    transform_summary
    .round(2)
    .sort_values(
        "Mean_Delta_Activity"
    )
)

print("\nTop transformations:")
print(transform_summary.head(20))

# ==========================================================
# SAVE FILES
# ==========================================================

pairs_df.to_csv(
    "mmp_pairs.csv",
    index=False
)

core_df.to_csv(
    "unique_conserved_cores.csv",
    index=False
)

transform_df.to_csv(
    "unique_transformations.csv",
    index=False
)

transform_summary.to_csv(
    "transformation_summary.csv",
    index=False
)

print("\nSaved files:")
print(" - mmp_pairs.csv")
print(" - unique_conserved_cores.csv")
print(" - unique_transformations.csv")
print(" - transformation_summary.csv")