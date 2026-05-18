import { animateProgress, showToast } from "./utils.js";
import {
  fetchMolImage,
  fetchPairsForCore,
  runAnalysisRequest,
  uploadJsonFile,
} from "./api.js";
import { createParts3DModal, createSingle3DModal } from "./viewers.js";

const state = { currentMode: null, allRows: [] };

const dom = {
  dropzone: document.getElementById("dropzone"),
  dropzoneInner: document.getElementById("dropzone-inner"),
  uploadProgress: document.getElementById("upload-progress"),
  fileInput: document.getElementById("file-input"),
  browseBtn: document.getElementById("browse-btn"),
  fileInfoBar: document.getElementById("file-info-bar"),
  fileInfoText: document.getElementById("file-info-text"),
  entriesBadge: document.getElementById("entries-badge"),
  actionRow: document.getElementById("action-row"),
  btnSar: document.getElementById("btn-sar"),
  btnMmpa: document.getElementById("btn-mmpa"),
  analysisLoading: document.getElementById("analysis-loading"),
  loadingLabel: document.getElementById("loading-label"),
  resultsSection: document.getElementById("results-section"),
  statsRow: document.getElementById("stats-row"),
  resultsTitle: document.getElementById("results-title"),
  searchInput: document.getElementById("search-input"),
  molThead: document.getElementById("mol-thead"),
  molTbody: document.getElementById("mol-tbody"),
  transformsBody: document.getElementById("transforms-tbody"),
  transformsCoreInfo: document.getElementById("transforms-core-info"),
  modalTransforms: document.getElementById("modal-transforms"),
  closeTransforms: document.getElementById("close-transforms"),
};

const single3DModal = createSingle3DModal({
  modal: document.getElementById("modal-3d"),
  close: document.getElementById("close-3d"),
  toggleRotation: document.getElementById("toggle-rotation"),
  smilesDisplay: document.getElementById("smiles-3d-display"),
  smilesCode: document.getElementById("viewer-smiles-code"),
  viewer: document.getElementById("viewer-3d"),
  styleButtons: [...document.querySelectorAll(".view-btn[data-style]")],
});

const parts3DModal = createParts3DModal({
  modal: document.getElementById("modal-3d-parts"),
  close: document.getElementById("close-3d-parts"),
  coreInfo: document.getElementById("parts-core-info"),
  grid: document.getElementById("parts-grid"),
  pagination: document.getElementById("parts-pagination"),
});

function bindUpload() {
  dom.browseBtn.addEventListener("click", () => dom.fileInput.click());
  dom.fileInput.addEventListener("change", () => dom.fileInput.files[0] && handleFile(dom.fileInput.files[0]));
  dom.dropzone.addEventListener("click", (event) => {
    if (event.target === dom.dropzone || event.target === dom.dropzoneInner) dom.fileInput.click();
  });
  dom.dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dom.dropzone.classList.add("drag-over");
  });
  dom.dropzone.addEventListener("dragleave", () => dom.dropzone.classList.remove("drag-over"));
  dom.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dom.dropzone.classList.remove("drag-over");
    if (event.dataTransfer.files[0]) handleFile(event.dataTransfer.files[0]);
  });
}

async function handleFile(file) {
  if (!file.name.endsWith(".json")) {
    showToast("Please upload a .json file", "error");
    return;
  }

  dom.dropzoneInner.style.display = "none";
  dom.uploadProgress.style.display = "flex";
  animateProgress();

  try {
    const data = await uploadJsonFile(file);
    if (data.error) throw new Error(data.error);
    dom.uploadProgress.style.display = "none";
    dom.dropzoneInner.style.display = "flex";
    dom.fileInfoText.textContent = `Uploaded ${data.filename}`;
    dom.entriesBadge.textContent = `${data.entries} entries`;
    dom.fileInfoBar.style.display = "flex";
    dom.actionRow.style.display = "flex";
    showToast(`Uploaded ${data.filename} - ${data.entries} compounds`, "success");
  } catch (err) {
    dom.uploadProgress.style.display = "none";
    dom.dropzoneInner.style.display = "flex";
    showToast(`Upload failed: ${err.message}`, "error");
  }
}

function bindActions() {
  dom.btnSar.addEventListener("click", () => runAnalysis("sar_split"));
  dom.btnMmpa.addEventListener("click", () => runAnalysis("mmpa"));
  dom.closeTransforms.addEventListener("click", closeTransforms);
  dom.modalTransforms.addEventListener("click", (event) => {
    if (event.target === dom.modalTransforms) closeTransforms();
  });
}

async function runAnalysis(mode) {
  state.currentMode = mode;
  dom.resultsSection.style.display = "none";
  dom.analysisLoading.style.display = "flex";
  dom.loadingLabel.textContent = mode === "sar_split"
    ? "Running SAR Split (Bemis-Murcko)..."
    : "Running MMP Analysis (rdMMPA)...";

  try {
    const data = await runAnalysisRequest(mode);
    if (data.error) throw new Error(data.error);
    dom.analysisLoading.style.display = "none";
    renderResults(mode, data);
  } catch (err) {
    dom.analysisLoading.style.display = "none";
    showToast(`Analysis failed: ${err.message}`, "error");
  }
}

function renderResults(mode, data) {
  dom.resultsSection.style.display = "block";
  window.scrollTo({ top: dom.resultsSection.offsetTop - 80, behavior: "smooth" });
  dom.statsRow.innerHTML = "";
  if (mode === "sar_split") {
    dom.resultsTitle.textContent = "Unique Scaffolds (SAR Split)";
    addStat(data.total_entries, "Total Entries");
    addStat(data.unique_scaffold_count, "Unique Scaffolds");
    addStat(data.unique_transformation_count, "Unique Transformations");
  } else {
    dom.resultsTitle.textContent = "Unique Conserved Cores (MMP Analysis)";
    addStat(data.unique_core_count, "Unique Cores");
    addStat(data.unique_transformation_count, "Unique Transformations");
    addStat(data.total_pairs, "Total MMP Pairs");
  }

  const headers = ["#", "2D Structure", "SMILES", "Actions", "Transformations"];
  if (mode === "mmpa") headers.splice(3, 0, "Pairs");
  dom.molThead.innerHTML = `<tr>${headers.map((item) => `<th>${item}</th>`).join("")}</tr>`;
  state.allRows = mode === "sar_split" ? data.scaffolds : data.cores;
  renderRows(state.allRows, mode);
  dom.searchInput.value = "";
  dom.searchInput.oninput = () => {
    const query = dom.searchInput.value.trim().toLowerCase();
    const rows = query ? state.allRows.filter((row) => row.smiles.toLowerCase().includes(query)) : state.allRows;
    renderRows(rows, mode);
  };
}

function addStat(value, label) {
  const card = document.createElement("div");
  card.className = "stat-card";
  card.innerHTML = `<div class="stat-value">${Number(value).toLocaleString()}</div><div class="stat-label">${label}</div>`;
  dom.statsRow.appendChild(card);
}

function renderRows(rows, mode) {
  dom.molTbody.innerHTML = rows.length
    ? ""
    : `<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:40px;">No results found</td></tr>`;
  rows.forEach((row, index) => dom.molTbody.appendChild(createRow(row, index, mode)));
}

function createRow(row, index, mode) {
  const tr = document.createElement("tr");
  const countCell = mode === "mmpa"
    ? `<td><span class="badge badge-cyan" title="${row.transformation_count} unique transformations">${row.pair_count ?? row.transformation_count} pairs</span></td>`
    : "";
  tr.innerHTML = `
    <td style="color:var(--text-3);font-weight:500;">${index + 1}</td>
    <td class="mol-img-cell">${row.image ? `<img src="data:image/png;base64,${row.image}" alt="${row.smiles}" style="background:#1a1a2e;padding:6px;">` : `<span style="color:var(--text-3);font-size:0.75rem;">No image</span>`}</td>
    <td class="smiles-cell" title="${row.smiles}">${row.smiles}</td>
    ${countCell}
    <td class="actions-cell"></td>
    <td class="transforms-cell">${buildTransformPreview(row.transformations || [])}</td>
  `;

  const actions = tr.querySelector(".actions-cell");
  actions.appendChild(actionButton("View 3D", () => single3DModal.open(row.smiles)));
  const partDisabled = !(row.part_examples || []).length;
  actions.appendChild(actionButton("View 3D Parts", () => parts3DModal.open(row), partDisabled));
  actions.appendChild(actionButton("All Transformations", () => openTransformations(row.smiles, row.transformations, mode), false, "link-transforms"));
  return tr;
}

function actionButton(label, onClick, disabled = false, extraClass = "link-3d") {
  const button = document.createElement("button");
  button.className = `link-btn ${extraClass}`;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function buildTransformPreview(transforms) {
  if (!transforms.length) return `<span style="color:var(--text-3);font-size:0.78rem;">-</span>`;
  const preview = transforms.slice(0, 3).map((item) => `<span class="transform-chip" title="${item}">${item.length > 40 ? `${item.slice(0, 38)}...` : item}</span>`).join("");
  return transforms.length > 3 ? `${preview}<span class="badge badge-amber" style="margin-left:4px;">+${transforms.length - 3} more</span>` : preview;
}

async function openTransformations(smiles, localTransforms, mode) {
  dom.transformsCoreInfo.textContent = smiles;
  dom.transformsBody.innerHTML = "";
  dom.modalTransforms.style.display = "flex";
  const pairs = mode === "mmpa" ? (await fetchPairsForCore(smiles)).pairs || [] : buildSarTransformRows(localTransforms || []);
  await renderTransformTable(pairs);
}

function buildSarTransformRows(transforms) {
  return transforms.map((item) => ({
    Transformation: item,
    Fragment_Out: item.split(">>")[0]?.trim() || "",
    Fragment_In: item.split(">>")[1]?.trim() || "",
    Compound_A: "-",
    Compound_B: "-",
    Delta_Activity: null,
    Delta_MW: null,
  }));
}

async function renderTransformTable(rows) {
  if (!rows.length) {
    dom.transformsBody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:28px;">No transformations found</td></tr>`;
    return;
  }
  for (const [index, row] of rows.entries()) dom.transformsBody.appendChild(await createTransformRow(row, index));
}

async function createTransformRow(row, index) {
  const tr = document.createElement("tr");
  const outImg = row.Fragment_Out && row.Fragment_Out !== "-" ? await fetchMolImage(row.Fragment_Out) : null;
  const inImg = row.Fragment_In && row.Fragment_In !== "-" ? await fetchMolImage(row.Fragment_In) : null;
  tr.innerHTML = `<td style="color:var(--text-3);">${index + 1}</td><td><code style="font-family:var(--font-mono);font-size:0.7rem;color:var(--indigo-light);word-break:break-all;">${row.Transformation || "-"}</code></td><td class="mol-img-cell" style="min-width:120px;"></td><td class="mol-img-cell" style="min-width:120px;"></td><td><span class="badge badge-indigo">${row.Compound_A || "-"}</span></td><td><span class="badge badge-cyan">${row.Compound_B || "-"}</span></td><td>${formatDelta(row.Delta_Activity, true)}</td><td>${formatDelta(row.Delta_MW, false)}</td>`;
  if (outImg) { outImg.style.padding = "4px"; tr.children[2].appendChild(outImg); }
  if (inImg) { inImg.style.padding = "4px"; tr.children[3].appendChild(inImg); }
  return tr;
}

function formatDelta(value, colorize) {
  if (value === null || value === undefined) return "-";
  if (!colorize) return `<span style="color:var(--text-2);">${value > 0 ? "+" : ""}${value}</span>`;
  const cls = value > 0 ? "delta-positive" : value < 0 ? "delta-negative" : "delta-neutral";
  return `<span class="${cls}">${value > 0 ? "+" : ""}${value}</span>`;
}

function closeTransforms() {
  dom.modalTransforms.style.display = "none";
  dom.transformsBody.innerHTML = "";
}

bindUpload();
bindActions();
