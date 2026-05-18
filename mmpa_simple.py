
import json
import pandas as pd
from rdkit import Chem
from rdkit.Chem.Scaffolds import MurckoScaffold

# Load the provided data
file_name = 'topoisomere_2_alpha_SAR.json'
with open(file_name, 'r') as f:
    data = json.load(f)

results = []
all_scaffolds = []
all_transformations = []

for entry in data:
    smiles = entry.get('canonical_smiles')
    mol = Chem.MolFromSmiles(smiles)
    
    if mol:
        # 1. Extract the Bemis-Murcko Scaffold
        scaffold_mol = MurckoScaffold.GetScaffoldForMol(mol)
        scaffold_smiles = Chem.MolToSmiles(scaffold_mol)
        
        # 2. Extract Transformations (Substituents)
        # ReplaceCore returns a Mol object containing all side-chains
        remnant = Chem.ReplaceCore(mol, scaffold_mol)
        
        # If there are multiple side-chains, MolToSmiles converts them 
        # into a single dot-separated string automatically.
        transformation_smiles = Chem.MolToSmiles(remnant) if remnant else "None"
        
        all_scaffolds.append(scaffold_smiles)
        all_transformations.append(transformation_smiles)
        
        results.append({
            "compound_id": entry.get("compound_chembl_id"),
            "scaffold": scaffold_smiles,
            "transformation": transformation_smiles,
            "potency": entry.get("standard_value")
        })

# Calculate Unique Lists
unique_scaffolds = sorted(list(set(all_scaffolds)))
unique_transformations = sorted(list(set(all_transformations)))

# Output Summary
print(f"Total entries processed: {len(data)}")
print(f"Unique Scaffolds: {len(unique_scaffolds)}")
print(f"Unique Transformations: {len(unique_transformations)}")

# Save to CSV for the user
df = pd.DataFrame(results)
df.to_csv('topoisomerase_analysis.csv', index=False)