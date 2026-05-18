/**
 * main.js — MMPA Analysis Web App
 * Handles file upload, analysis runs, table rendering,
 * 3D molecule viewer (3Dmol.js), and transformation popup.
 */

/* =========================================================
   STATE
   ========================================================= */
let currentMode = null;   // 'sar_split' | 'mmpa'
let allRows = [];          // full scaffold/core list for filtering
let viewer3d = null;       // 3Dmol viewer instance
let currentSmiles = '';
let current3DParts = null;
let is3DRotating = false;
let partViewers = [];

/* =========================================================
   DOM REFERENCES
   ========================================================= */
const dropzone       = document.getElementById('dropzone');
const dropzoneInner  = document.getElementById('dropzone-inner');
const uploadProgress = document.getElementById('upload-progress');
const fileInput      = document.getElementById('file-input');
const browseBtn      = document.getElementById('browse-btn');
const fileInfoBar    = document.getElementById('file-info-bar');
const fileInfoText   = document.getElementById('file-info-text');
const entriesBadge   = document.getElementById('entries-badge');
const actionRow      = document.getElementById('action-row');
const btnSar         = document.getElementById('btn-sar');
const btnMmpa        = document.getElementById('btn-mmpa');
const analysisLoading= document.getElementById('analysis-loading');
const loadingLabel   = document.getElementById('loading-label');
const resultsSection = document.getElementById('results-section');
const statsRow       = document.getElementById('stats-row');
const resultsTitle   = document.getElementById('results-title');
const searchInput    = document.getElementById('search-input');
const molThead       = document.getElementById('mol-thead');
const molTbody       = document.getElementById('mol-tbody');

// Modals
const modal3d        = document.getElementById('modal-3d');
const close3d        = document.getElementById('close-3d');
const toggleRotation = document.getElementById('toggle-rotation');
const smiles3dDisplay= document.getElementById('smiles-3d-display');
const viewerSmilesCode=document.getElementById('viewer-smiles-code');
const viewerDiv      = document.getElementById('viewer-3d');
const modal3dParts   = document.getElementById('modal-3d-parts');
const close3dParts   = document.getElementById('close-3d-parts');
const partsCoreInfo  = document.getElementById('parts-core-info');
const partsGrid      = document.getElementById('parts-grid');
const modalTransforms= document.getElementById('modal-transforms');
const closeTransforms= document.getElementById('close-transforms');
const transformsBody = document.getElementById('transforms-tbody');
const transformsCoreInfo = document.getElementById('transforms-core-info');

/* =========================================================
   FILE UPLOAD
   ========================================================= */
browseBtn.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('click', (e) => {
  if (e.target === dropzone || e.target === dropzoneInner) fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  if (!file.name.endsWith('.json')) {
    showToast('Please upload a .json file', 'error');
    return;
  }

  // Show progress
  dropzoneInner.style.display = 'none';
  uploadProgress.style.display = 'flex';
  animateProgress();

  const formData = new FormData();
  formData.append('json_file', file);

  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.error) {
      showToast(data.error, 'error');
      resetDropzone();
      return;
    }

    // Show success
    uploadProgress.style.display = 'none';
    dropzoneInner.style.display = 'flex';

    fileInfoText.textContent = `✓  ${data.filename}`;
    entriesBadge.textContent = `${data.entries} entries`;
    fileInfoBar.style.display = 'flex';
    actionRow.style.display = 'flex';

    showToast(`Uploaded ${data.filename} — ${data.entries} compounds`, 'success');
  } catch (err) {
    showToast('Upload failed: ' + err.message, 'error');
    resetDropzone();
  }
}

function resetDropzone() {
  uploadProgress.style.display = 'none';
  dropzoneInner.style.display = 'flex';
}

function animateProgress() {
  const circle = document.getElementById('progress-circle');
  if (!circle) return;
  const total = 150.796;
  let offset = total;
  const interval = setInterval(() => {
    offset -= 3;
    if (offset <= 0) { clearInterval(interval); return; }
    circle.style.strokeDashoffset = offset;
  }, 40);
}

/* =========================================================
   RUN ANALYSIS
   ========================================================= */
btnSar.addEventListener('click', () => runAnalysis('sar_split'));
btnMmpa.addEventListener('click', () => runAnalysis('mmpa'));

async function runAnalysis(mode) {
  currentMode = mode;
  resultsSection.style.display = 'none';
  analysisLoading.style.display = 'flex';
  loadingLabel.textContent = mode === 'sar_split'
    ? 'Running SAR Split (Bemis-Murcko)…'
    : 'Running MMP Analysis (rdMMPA)…';

  try {
    const url = mode === 'sar_split' ? '/run/sar_split' : '/run/mmpa';
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();

    if (data.error) {
      showToast(data.error, 'error');
      analysisLoading.style.display = 'none';
      return;
    }

    analysisLoading.style.display = 'none';
    renderResults(mode, data);
  } catch (err) {
    showToast('Analysis failed: ' + err.message, 'error');
    analysisLoading.style.display = 'none';
  }
}

/* =========================================================
   RENDER RESULTS
   ========================================================= */
function renderResults(mode, data) {
  resultsSection.style.display = 'block';
  window.scrollTo({ top: resultsSection.offsetTop - 80, behavior: 'smooth' });

  // Stats bar
  statsRow.innerHTML = '';
  if (mode === 'sar_split') {
    resultsTitle.textContent = 'Unique Scaffolds (SAR Split)';
    addStat(data.total_entries, 'Total Entries');
    addStat(data.unique_scaffold_count, 'Unique Scaffolds');
    addStat(data.unique_transformation_count, 'Unique Transformations');
  } else {
    resultsTitle.textContent = 'Unique Conserved Cores (MMP Analysis)';
    addStat(data.unique_core_count, 'Unique Cores');
    addStat(data.unique_transformation_count, 'Unique Transformations');
    addStat(data.total_pairs, 'Total MMP Pairs');
  }

  // Table header
  molThead.innerHTML = '';
  const headRow = document.createElement('tr');
  const headers = ['#', '2D Structure', 'SMILES', 'Actions', 'Transformations'];
  if (mode === 'mmpa') headers.splice(3, 0, 'Count');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    headRow.appendChild(th);
  });
  molThead.appendChild(headRow);

  // Table rows
  allRows = mode === 'sar_split' ? data.scaffolds : data.cores;
  renderRows(allRows, mode);

  // Search filter
  searchInput.value = '';
  searchInput.oninput = () => {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = q ? allRows.filter(r => r.smiles.toLowerCase().includes(q)) : allRows;
    renderRows(filtered, mode);
  };
}

function addStat(value, label) {
  const card = document.createElement('div');
  card.className = 'stat-card';
  card.innerHTML = `<div class="stat-value">${Number(value).toLocaleString()}</div><div class="stat-label">${label}</div>`;
  statsRow.appendChild(card);
}

function renderRows(rows, mode) {
  molTbody.innerHTML = '';

  if (!rows || rows.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" style="text-align:center;color:var(--text-3);padding:40px;">No results found</td>`;
    molTbody.appendChild(tr);
    return;
  }

  rows.forEach((row, idx) => {
    const tr = document.createElement('tr');

    // Index
    const tdIdx = document.createElement('td');
    tdIdx.textContent = idx + 1;
    tdIdx.style.color = 'var(--text-3)';
    tdIdx.style.fontWeight = '500';
    tr.appendChild(tdIdx);

    // 2D Image
    const tdImg = document.createElement('td');
    tdImg.className = 'mol-img-cell';
    if (row.image) {
      const img = document.createElement('img');
      img.src = `data:image/png;base64,${row.image}`;
      img.alt = row.smiles;
      img.style.background = '#1a1a2e';
      img.style.padding = '6px';
      tdImg.appendChild(img);
    } else {
      tdImg.innerHTML = `<span style="color:var(--text-3);font-size:0.75rem;">No image</span>`;
    }
    tr.appendChild(tdImg);

    // SMILES
    const tdSmiles = document.createElement('td');
    tdSmiles.className = 'smiles-cell';
    tdSmiles.title = row.smiles;
    tdSmiles.textContent = row.smiles;
    tr.appendChild(tdSmiles);

    // Count (MMP only)
    if (mode === 'mmpa') {
      const tdCount = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'badge badge-cyan';
      badge.textContent = row.transformation_count;
      tdCount.appendChild(badge);
      tr.appendChild(tdCount);
    }

    // Actions
    const tdActions = document.createElement('td');
    tdActions.className = 'actions-cell';

    const btn3d = document.createElement('button');
    btn3d.className = 'link-btn link-3d';
    btn3d.dataset.smiles = row.smiles;
    btn3d.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="width:13px;height:13px;"><path d="M8 2a6 6 0 100 12A6 6 0 008 2z"/><path d="M8 2c-1.5 1.5-2 3.5-2 6s.5 4.5 2 6"/><path d="M8 2c1.5 1.5 2 3.5 2 6s-.5 4.5-2 6"/><path d="M2 8h12"/></svg> View 3D`;
    btn3d.addEventListener('click', () => open3DViewer(row.smiles));
    tdActions.appendChild(btn3d);

    const btn3dParts = document.createElement('button');
    btn3dParts.className = 'link-btn link-3d';
    btn3dParts.dataset.count = String((row.part_examples || []).length);
    btn3dParts.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="width:13px;height:13px;"><path d="M3 8h10"/><path d="M8 3v10"/><circle cx="5" cy="8" r="2"/><circle cx="11" cy="8" r="2"/></svg> View 3D Parts`;
    btn3dParts.disabled = !(row.part_examples || []).length;
    btn3dParts.title = (row.part_examples || []).length
      ? 'View all example molecules with scaffold/core and remainder in different colors'
      : 'No example molecule available';
    btn3dParts.addEventListener('click', () => open3DPartsViewer(row));
    tdActions.appendChild(btn3dParts);

    const btnT = document.createElement('button');
    btnT.className = 'link-btn link-transforms';
    btnT.dataset.smiles = row.smiles;
    btnT.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="width:13px;height:13px;"><path d="M4 8h8M10 5l3 3-3 3"/><path d="M12 4H6a2 2 0 00-2 2v4a2 2 0 002 2h6"/></svg> All Transformations`;
    btnT.addEventListener('click', () => openTransformations(row.smiles, row.transformations, mode));
    tdActions.appendChild(btnT);

    tr.appendChild(tdActions);

    // Transformations preview
    const tdTrans = document.createElement('td');
    tdTrans.className = 'transforms-cell';
    const transforms = row.transformations || [];
    if (transforms.length === 0) {
      tdTrans.innerHTML = `<span style="color:var(--text-3);font-size:0.78rem;">—</span>`;
    } else {
      const preview = transforms.slice(0, 3);
      preview.forEach(t => {
        const chip = document.createElement('span');
        chip.className = 'transform-chip';
        chip.title = t;
        chip.textContent = t.length > 40 ? t.slice(0, 38) + '…' : t;
        tdTrans.appendChild(chip);
      });
      if (transforms.length > 3) {
        const more = document.createElement('span');
        more.className = 'badge badge-amber';
        more.style.cursor = 'pointer';
        more.style.marginLeft = '4px';
        more.textContent = `+${transforms.length - 3} more`;
        more.addEventListener('click', () => openTransformations(row.smiles, row.transformations, mode));
        tdTrans.appendChild(more);
      }
    }
    tr.appendChild(tdTrans);

    molTbody.appendChild(tr);
  });
}

/* =========================================================
   3D VIEWER POPUP
   ========================================================= */
async function open3DViewer(smiles, options = {}) {
  currentSmiles = smiles;
  current3DParts = null;
  is3DRotating = false;
  updateRotationButton();
  smiles3dDisplay.textContent = smiles;
  viewerSmilesCode.textContent = smiles;
  modal3d.style.display = 'flex';

  // Clear viewer
  viewerDiv.innerHTML = '';

  try {
    const params = new URLSearchParams({ smiles });
    if (options.highlightSmiles) params.set('highlight', options.highlightSmiles);
    const res = await fetch(`/api/mol_3d?${params.toString()}`);
    const data = await res.json();
    const displaySmiles = data.smiles || smiles;
    currentSmiles = displaySmiles;
    smiles3dDisplay.textContent = displaySmiles;
    viewerSmilesCode.textContent = displaySmiles;

    if (!data.sdf) {
      viewerDiv.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-3);">Could not generate 3D conformer for this molecule.</div>`;
      return;
    }

    // Create 3Dmol viewer
    viewer3d = $3Dmol.createViewer(viewerDiv, {
      backgroundColor: '#0d0f1f',
      id: 'mol3d-viewer',
    });

    viewer3d.addModel(data.sdf, 'sdf');
    current3DParts = data.part_a_atoms?.length
      ? { partA: data.part_a_atoms, partB: data.part_b_atoms || [] }
      : null;
    applyViewStyle('stick');
    viewer3d.zoomTo();
    viewer3d.spin(is3DRotating);
    viewer3d.render();

  } catch (err) {
    viewerDiv.innerHTML = `<div style="padding:20px;color:var(--rose);">Error: ${err.message}</div>`;
  }
}

function applyViewStyle(style) {
  if (!viewer3d) return;
  viewer3d.setStyle({}, {});
  const baseStyle = getStyleForMode(style, '#cbd5e1');

  if (current3DParts) {
    viewer3d.setStyle({ index: current3DParts.partA }, getStyleForMode(style, '#38bdf8'));
    viewer3d.setStyle({ index: current3DParts.partB }, getStyleForMode(style, '#f97316'));
  } else {
    viewer3d.setStyle({}, baseStyle);
  }
  viewer3d.render();
}

function getStyleForMode(style, color) {
  switch (style) {
    case 'stick':
      return { stick: { radius: 0.15, color }, sphere: { scale: 0.3, color } };
    case 'sphere':
      return { sphere: { color } };
    case 'line':
      return { line: { color } };
    case 'cross':
      return { cross: { lineWidth: 5, color } };
    case 'cartoon':
      return { stick: { radius: 0.1, color }, cartoon: { color } };
    default:
      return { stick: { radius: 0.15, color }, sphere: { scale: 0.3, color } };
  }
}

function updateRotationButton() {
  if (!toggleRotation) return;
  toggleRotation.classList.toggle('active', is3DRotating);
  toggleRotation.title = is3DRotating ? 'Stop rotation' : 'Start rotation';
}

// View style buttons
document.querySelectorAll('.view-btn').forEach(btn => {
  if (btn === toggleRotation) return;
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyViewStyle(btn.dataset.style);
    updateRotationButton();
  });
});

toggleRotation.addEventListener('click', () => {
  if (!viewer3d) return;
  is3DRotating = !is3DRotating;
  viewer3d.spin(is3DRotating);
  viewer3d.render();
  updateRotationButton();
});

close3d.addEventListener('click', () => {
  modal3d.style.display = 'none';
  if (viewer3d) { viewer3d.spin(false); viewer3d = null; }
  current3DParts = null;
  is3DRotating = false;
  updateRotationButton();
  viewerDiv.innerHTML = '';
});

modal3d.addEventListener('click', (e) => {
  if (e.target === modal3d) close3d.click();
});

async function open3DPartsViewer(row) {
  close3DPartsViewer();
  partsCoreInfo.textContent = row.smiles;
  modal3dParts.style.display = 'flex';

  const examples = row.part_examples || [];
  if (!examples.length) {
    partsGrid.innerHTML = `<div class="parts-empty">No 3D part examples available for this row.</div>`;
    return;
  }

  const cards = examples.map((example, idx) => create3DPartCard(example, idx));
  cards.forEach(card => partsGrid.appendChild(card.element));
  await Promise.all(cards.map(card => load3DPartCard(card, row.smiles)));
}

function create3DPartCard(example, idx) {
  const card = document.createElement('article');
  card.className = 'part-card';
  card.innerHTML = `
    <div class="part-card-header">
      <div>
        <div class="part-card-title">${escapeHtml(example.label || `Example ${idx + 1}`)}</div>
        <div class="part-card-subtitle">${escapeHtml(example.compound_id || 'Compound')}</div>
      </div>
      <button class="link-btn link-3d part-rotate-btn" type="button">Rotate</button>
    </div>
    <div class="part-card-transform">${escapeHtml(example.transformation || 'No transformation')}</div>
    <div class="part-viewer" id="part-viewer-${idx}"></div>
    <div class="part-card-smiles">${escapeHtml(example.smiles || '')}</div>
  `;

  const viewerHost = card.querySelector(`#part-viewer-${idx}`);
  const rotateBtn = card.querySelector('.part-rotate-btn');
  const viewerState = { viewer: null, rotating: false, button: rotateBtn };

  rotateBtn.addEventListener('click', () => {
    if (!viewerState.viewer) return;
    viewerState.rotating = !viewerState.rotating;
    viewerState.viewer.spin(viewerState.rotating);
    viewerState.viewer.render();
    rotateBtn.textContent = viewerState.rotating ? 'Stop' : 'Rotate';
  });

  partViewers.push(viewerState);
  return { element: card, example, viewerHost, viewerState };
}

async function load3DPartCard(card, fallbackHighlightSmiles) {
  try {
    const params = new URLSearchParams({ smiles: card.example.smiles || '' });
    params.set('highlight', card.example.highlight_smiles || fallbackHighlightSmiles || '');
    const res = await fetch(`/api/mol_3d?${params.toString()}`);
    const data = await res.json();

    if (!data.sdf) {
      card.viewerHost.innerHTML = `<div class="part-viewer-error">Could not generate 3D conformer for this molecule.</div>`;
      return;
    }

    const viewer = $3Dmol.createViewer(card.viewerHost, {
      backgroundColor: '#0d0f1f',
      id: `parts-viewer-${Math.random().toString(36).slice(2)}`,
    });

    viewer.addModel(data.sdf, 'sdf');
    if (data.part_a_atoms?.length) {
      viewer.setStyle({ index: data.part_a_atoms }, { stick: { radius: 0.14, color: '#38bdf8' }, sphere: { scale: 0.28, color: '#38bdf8' } });
      viewer.setStyle({ index: data.part_b_atoms || [] }, { stick: { radius: 0.14, color: '#f97316' }, sphere: { scale: 0.28, color: '#f97316' } });
    } else {
      viewer.setStyle({}, { stick: { radius: 0.14, color: '#cbd5e1' }, sphere: { scale: 0.28, color: '#cbd5e1' } });
    }
    viewer.zoomTo();
    viewer.spin(false);
    viewer.render();

    card.viewerState.viewer = viewer;
    card.viewerState.rotating = false;
    card.viewerState.button.textContent = 'Rotate';
    const smilesNode = card.element.querySelector('.part-card-smiles');
    if (smilesNode) smilesNode.textContent = data.smiles || card.example.smiles || '';
  } catch (err) {
    card.viewerHost.innerHTML = `<div class="part-viewer-error">Error: ${err.message}</div>`;
  }
}

function close3DPartsViewer() {
  partViewers.forEach(state => {
    if (state.viewer) state.viewer.spin(false);
  });
  partViewers = [];
  partsGrid.innerHTML = '';
}

close3dParts.addEventListener('click', () => {
  modal3dParts.style.display = 'none';
  close3DPartsViewer();
});

modal3dParts.addEventListener('click', (e) => {
  if (e.target === modal3dParts) close3dParts.click();
});

/* =========================================================
   TRANSFORMATIONS POPUP
   ========================================================= */
async function openTransformations(smiles, localTransforms, mode) {
  transformsCoreInfo.textContent = smiles;
  transformsBody.innerHTML = '';
  modalTransforms.style.display = 'flex';

  if (mode === 'mmpa') {
    // Fetch full pair detail from backend
    try {
      const res = await fetch(`/api/pairs_for_core?core=${encodeURIComponent(smiles)}`);
      const data = await res.json();
      renderTransformTable(data.pairs || []);
    } catch (err) {
      transformsBody.innerHTML = `<tr><td colspan="8" style="color:var(--rose);padding:20px;">${err.message}</td></tr>`;
    }
  } else {
    // SAR split mode — display flat list
    const rows = (localTransforms || []).map((t, i) => ({
      Transformation: t,
      Fragment_Out: t.split('>>')[0]?.trim() || '',
      Fragment_In: t.split('>>')[1]?.trim() || '',
      Compound_A: '—', Compound_B: '—',
      Delta_Activity: null, Delta_MW: null,
    }));
    renderTransformTable(rows);
  }
}

async function renderTransformTable(pairs) {
  transformsBody.innerHTML = '';
  if (!pairs || pairs.length === 0) {
    transformsBody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:28px;">No transformations found</td></tr>`;
    return;
  }

  for (const [i, p] of pairs.entries()) {
    const tr = document.createElement('tr');

    // Index
    const tdI = document.createElement('td');
    tdI.style.color = 'var(--text-3)';
    tdI.textContent = i + 1;
    tr.appendChild(tdI);

    // Transformation SMILES
    const tdT = document.createElement('td');
    const chip = document.createElement('code');
    chip.style.cssText = 'font-family:var(--font-mono);font-size:0.7rem;color:var(--indigo-light);word-break:break-all;';
    chip.textContent = p.Transformation || '—';
    tdT.appendChild(chip);
    tr.appendChild(tdT);

    // Fragment Out image
    const tdFO = document.createElement('td');
    tdFO.className = 'mol-img-cell';
    tdFO.style.minWidth = '120px';
    if (p.Fragment_Out && p.Fragment_Out !== '—') {
      const img = await fetchMolImage(p.Fragment_Out, 140, 90);
      if (img) { img.style.padding = '4px'; tdFO.appendChild(img); }
    } else {
      tdFO.textContent = '—';
    }
    tr.appendChild(tdFO);

    // Fragment In image
    const tdFI = document.createElement('td');
    tdFI.className = 'mol-img-cell';
    tdFI.style.minWidth = '120px';
    if (p.Fragment_In && p.Fragment_In !== '—') {
      const img = await fetchMolImage(p.Fragment_In, 140, 90);
      if (img) { img.style.padding = '4px'; tdFI.appendChild(img); }
    } else {
      tdFI.textContent = '—';
    }
    tr.appendChild(tdFI);

    // Compounds
    const tdCA = document.createElement('td');
    tdCA.innerHTML = `<span class="badge badge-indigo">${p.Compound_A || '—'}</span>`;
    tr.appendChild(tdCA);

    const tdCB = document.createElement('td');
    tdCB.innerHTML = `<span class="badge badge-cyan">${p.Compound_B || '—'}</span>`;
    tr.appendChild(tdCB);

    // Delta Activity
    const tdDA = document.createElement('td');
    if (p.Delta_Activity !== null && p.Delta_Activity !== undefined) {
      const cls = p.Delta_Activity > 0 ? 'delta-positive' : p.Delta_Activity < 0 ? 'delta-negative' : 'delta-neutral';
      tdDA.innerHTML = `<span class="${cls}">${p.Delta_Activity > 0 ? '+' : ''}${p.Delta_Activity}</span>`;
    } else {
      tdDA.textContent = '—';
    }
    tr.appendChild(tdDA);

    // Delta MW
    const tdDM = document.createElement('td');
    if (p.Delta_MW !== null && p.Delta_MW !== undefined) {
      tdDM.innerHTML = `<span style="color:var(--text-2);">${p.Delta_MW > 0 ? '+' : ''}${p.Delta_MW}</span>`;
    } else {
      tdDM.textContent = '—';
    }
    tr.appendChild(tdDM);

    transformsBody.appendChild(tr);
  }
}

async function fetchMolImage(smiles, w=140, h=90) {
  try {
    const res = await fetch(`/api/mol_image?smiles=${encodeURIComponent(smiles)}&w=${w}&h=${h}`);
    const data = await res.json();
    if (data.image) {
      const img = document.createElement('img');
      img.src = `data:image/png;base64,${data.image}`;
      img.alt = smiles;
      img.style.background = '#1a1a2e';
      img.style.borderRadius = '4px';
      img.style.display = 'block';
      img.style.margin = '0 auto';
      return img;
    }
  } catch {}
  return null;
}

closeTransforms.addEventListener('click', () => {
  modalTransforms.style.display = 'none';
  transformsBody.innerHTML = '';
});
modalTransforms.addEventListener('click', (e) => {
  if (e.target === modalTransforms) closeTransforms.click();
});

/* =========================================================
   TOAST NOTIFICATIONS
   ========================================================= */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  const colors = { success: '#22c55e', error: '#f43f5e', info: '#6366f1' };
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999;
    padding:14px 20px; border-radius:10px; font-size:0.88rem; font-weight:500;
    background: rgba(13,15,31,0.95); border: 1px solid ${colors[type]||colors.info}40;
    color: var(--text-1); box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    backdrop-filter: blur(16px); max-width: 380px;
    border-left: 3px solid ${colors[type]||colors.info};
    animation: slideUp 0.25s cubic-bezier(0.4,0,0.2,1);
    display: flex; align-items: center; gap: 10px;
  `;
  const dot = document.createElement('span');
  dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${colors[type]||colors.info};flex-shrink:0;`;
  toast.appendChild(dot);
  const txt = document.createElement('span');
  txt.textContent = message;
  toast.appendChild(txt);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
