import { escapeHtml } from "./utils.js";
import { fetch3D } from "./api.js";

function styleForMode(style, color) {
  switch (style) {
    case "sphere":
      return { sphere: { color } };
    case "line":
      return { line: { color } };
    case "cross":
      return { cross: { lineWidth: 5, color } };
    case "cartoon":
      return { stick: { radius: 0.1, color }, cartoon: { color } };
    default:
      return { stick: { radius: 0.15, color }, sphere: { scale: 0.3, color } };
  }
}

function renderViewerStyles(viewer, style, parts) {
  viewer.setStyle({}, {});
  if (parts?.partA?.length) {
    viewer.setStyle({ index: parts.partA }, styleForMode(style, "#38bdf8"));
    viewer.setStyle({ index: parts.partB || [] }, styleForMode(style, "#f97316"));
  } else {
    viewer.setStyle({}, styleForMode(style, "#cbd5e1"));
  }
  viewer.render();
}

export function createSingle3DModal(elements) {
  let viewer = null;
  let currentParts = null;
  let rotating = false;

  function syncRotationButton() {
    elements.toggleRotation.classList.toggle("active", rotating);
    elements.toggleRotation.title = rotating ? "Stop rotation" : "Start rotation";
  }

  function close() {
    elements.modal.style.display = "none";
    if (viewer) viewer.spin(false);
    viewer = null;
    currentParts = null;
    rotating = false;
    syncRotationButton();
    elements.viewer.innerHTML = "";
  }

  async function open(smiles, options = {}) {
    currentParts = null;
    rotating = false;
    syncRotationButton();
    elements.smilesDisplay.textContent = smiles;
    elements.smilesCode.textContent = smiles;
    elements.modal.style.display = "flex";
    elements.viewer.innerHTML = "";

    try {
      const data = await fetch3D(smiles, options.highlightSmiles || "");
      const displaySmiles = data.smiles || smiles;
      elements.smilesDisplay.textContent = displaySmiles;
      elements.smilesCode.textContent = displaySmiles;

      if (!data.sdf) {
        elements.viewer.innerHTML = `<div class="viewer-error">Could not generate 3D conformer for this molecule.</div>`;
        return;
      }

      viewer = $3Dmol.createViewer(elements.viewer, {
        backgroundColor: "#0d0f1f",
        id: "mol3d-viewer",
      });
      viewer.addModel(data.sdf, "sdf");
      currentParts = data.part_a_atoms?.length
        ? { partA: data.part_a_atoms, partB: data.part_b_atoms || [] }
        : null;
      renderViewerStyles(viewer, "stick", currentParts);
      viewer.zoomTo();
      viewer.spin(false);
      viewer.render();
    } catch (err) {
      elements.viewer.innerHTML = `<div class="viewer-error">Error: ${err.message}</div>`;
    }
  }

  elements.styleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      elements.styleButtons.forEach((node) => node.classList.remove("active"));
      btn.classList.add("active");
      if (viewer) renderViewerStyles(viewer, btn.dataset.style, currentParts);
    });
  });

  elements.toggleRotation.addEventListener("click", () => {
    if (!viewer) return;
    rotating = !rotating;
    viewer.spin(rotating);
    viewer.render();
    syncRotationButton();
  });
  elements.close.addEventListener("click", close);
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) close();
  });

  syncRotationButton();
  return { open, close };
}

export function createParts3DModal(elements) {
  let activeViewers = [];
  let currentPage = 1;
  let currentExamples = [];
  let currentHighlightSmiles = "";
  const PAGE_SIZE = 15;

  // ── helpers ──────────────────────────────────────────────────────────────

  function stopViewers() {
    activeViewers.forEach((item) => {
      if (item.viewer) {
        try { item.viewer.spin(false); } catch (_) {}
      }
      item.viewer = null;
    });
    activeViewers = [];
  }

  function setPaginationHTML(html) {
    if (elements.pagination) elements.pagination.innerHTML = html;
  }

  // ── card builder ─────────────────────────────────────────────────────────

  function buildCard(example, globalIndex) {
    const card = document.createElement("article");
    card.className = "part-card";
    card.innerHTML = `
      <div class="part-card-header">
        <div>
          <div class="part-card-title">${escapeHtml(example.label || `Example ${globalIndex + 1}`)}</div>
          <div class="part-card-subtitle">${escapeHtml(example.compound_id || "Compound")}</div>
        </div>
        <button class="link-btn link-3d part-rotate-btn" type="button">Rotate</button>
      </div>
      <div class="part-card-transform">${escapeHtml(example.transformation || "No transformation")}</div>
      <div class="part-viewer"></div>
      <div class="part-card-smiles">${escapeHtml(example.smiles || "")}</div>
    `;
    return card;
  }

  async function renderCard(card, example) {
    const viewerHost  = card.querySelector(".part-viewer");
    const rotateBtn   = card.querySelector(".part-rotate-btn");
    const smilesNode  = card.querySelector(".part-card-smiles");
    const state       = { viewer: null, rotating: false };
    activeViewers.push(state);

    rotateBtn.addEventListener("click", () => {
      if (!state.viewer) return;
      state.rotating = !state.rotating;
      state.viewer.spin(state.rotating);
      state.viewer.render();
      rotateBtn.textContent = state.rotating ? "Stop" : "Rotate";
    });

    try {
      const data = await fetch3D(
        example.smiles || "",
        example.highlight_smiles || currentHighlightSmiles
      );
      if (!data.sdf) {
        viewerHost.innerHTML = `<div class="part-viewer-error">Could not generate 3D conformer.</div>`;
        return;
      }
      const viewer = $3Dmol.createViewer(viewerHost, { backgroundColor: "#0d0f1f" });
      viewer.addModel(data.sdf, "sdf");
      const parts = data.part_a_atoms?.length
        ? { partA: data.part_a_atoms, partB: data.part_b_atoms || [] }
        : null;
      renderViewerStyles(viewer, "stick", parts);
      viewer.zoomTo();
      viewer.spin(false);
      viewer.render();
      state.viewer = viewer;
      if (smilesNode) smilesNode.textContent = data.smiles || example.smiles || "";
    } catch (err) {
      viewerHost.innerHTML = `<div class="part-viewer-error">Error: ${err.message}</div>`;
    }
  }

  // ── pagination ────────────────────────────────────────────────────────────

  function renderPagination() {
    if (!elements.pagination) return;
    const totalPages = Math.ceil(currentExamples.length / PAGE_SIZE);
    if (totalPages <= 1) { setPaginationHTML(""); return; }

    const prevDis = currentPage === 1        ? "disabled" : "";
    const nextDis = currentPage === totalPages ? "disabled" : "";

    setPaginationHTML(`
      <button class="parts-page-btn" ${prevDis}>&larr; Prev</button>
      <span class="parts-page-info">
        Page <strong>${currentPage}</strong> of <strong>${totalPages}</strong>
        &nbsp;&middot;&nbsp; ${currentExamples.length} pairs total
      </span>
      <button class="parts-page-btn" ${nextDis}>Next &rarr;</button>
    `);

    const [prevBtn, nextBtn] = elements.pagination.querySelectorAll("button");
    prevBtn.addEventListener("click", () => {
      if (currentPage > 1) { currentPage--; renderPage(currentPage); }
    });
    nextBtn.addEventListener("click", () => {
      if (currentPage < totalPages) { currentPage++; renderPage(currentPage); }
    });
  }

  // ── page renderer ─────────────────────────────────────────────────────────

  async function renderPage(page) {
    stopViewers();
    elements.grid.innerHTML = "";
    currentPage = page;

    const start = (page - 1) * PAGE_SIZE;
    const slice = currentExamples.slice(start, start + PAGE_SIZE);

    if (elements.modalContainer) elements.modalContainer.scrollTop = 0;

    if (!slice.length) {
      elements.grid.innerHTML = `<div class="parts-empty">No pairs on this page.</div>`;
      renderPagination();
      return;
    }

    const promises = slice.map((example, i) => {
      const card = buildCard(example, start + i);
      elements.grid.appendChild(card);
      return renderCard(card, example);
    });

    renderPagination();           // show buttons immediately (before async resolves)
    await Promise.all(promises);  // then load all 3D conformers for this page
  }

  // ── public open / close ───────────────────────────────────────────────────

  async function open(row) {
    // Tear down any previous state without hiding the modal first
    stopViewers();
    elements.grid.innerHTML = "";
    setPaginationHTML("");

    currentExamples        = row.part_examples || [];
    currentHighlightSmiles = row.smiles || "";
    currentPage            = 1;

    if (elements.coreInfo) elements.coreInfo.textContent = row.smiles || "";
    elements.modal.style.display = "flex";

    if (!currentExamples.length) {
      elements.grid.innerHTML = `<div class="parts-empty">No 3D part examples available for this core.</div>`;
      return;
    }

    await renderPage(1);
  }

  function close() {
    stopViewers();
    currentExamples        = [];
    currentHighlightSmiles = "";
    currentPage            = 1;
    elements.grid.innerHTML = "";
    setPaginationHTML("");
    elements.modal.style.display = "none";
  }

  // ── event listeners ───────────────────────────────────────────────────────

  elements.close.addEventListener("click", close);
  elements.modal.addEventListener("click", (evt) => {
    if (evt.target === elements.modal) close();
  });

  return { open, close };
}
