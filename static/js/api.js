export async function fetchJson(url, options) {
  const res = await fetch(url, options);
  return res.json();
}

export async function fetchMolImage(smiles, width = 140, height = 90) {
  try {
    const data = await fetchJson(
      `/api/mol_image?smiles=${encodeURIComponent(smiles)}&w=${width}&h=${height}`
    );
    if (!data.image) return null;

    const img = document.createElement("img");
    img.src = `data:image/png;base64,${data.image}`;
    img.alt = smiles;
    img.style.background = "#1a1a2e";
    img.style.borderRadius = "4px";
    img.style.display = "block";
    img.style.margin = "0 auto";
    return img;
  } catch {
    return null;
  }
}

export async function fetch3D(smiles, highlightSmiles = "") {
  const params = new URLSearchParams({ smiles });
  if (highlightSmiles) params.set("highlight", highlightSmiles);
  return fetchJson(`/api/mol_3d?${params.toString()}`);
}

export async function uploadJsonFile(file) {
  const formData = new FormData();
  formData.append("json_file", file);
  return fetchJson("/upload", { method: "POST", body: formData });
}

export async function runAnalysisRequest(mode) {
  const url = mode === "sar_split" ? "/run/sar_split" : "/run/mmpa";
  return fetchJson(url, { method: "POST" });
}

export async function fetchPairsForCore(smiles) {
  return fetchJson(`/api/pairs_for_core?core=${encodeURIComponent(smiles)}`);
}
