export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function showToast(message, type = "info") {
  const colors = { success: "#22c55e", error: "#f43f5e", info: "#6366f1" };
  const toast = document.createElement("div");
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999;
    padding:14px 20px; border-radius:10px; font-size:0.88rem; font-weight:500;
    background: rgba(13,15,31,0.95); border: 1px solid ${colors[type] || colors.info}40;
    color: var(--text-1); box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    backdrop-filter: blur(16px); max-width: 380px;
    border-left: 3px solid ${colors[type] || colors.info};
    animation: slideUp 0.25s cubic-bezier(0.4,0,0.2,1);
    display: flex; align-items: center; gap: 10px;
  `;

  const dot = document.createElement("span");
  dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${colors[type] || colors.info};flex-shrink:0;`;
  toast.appendChild(dot);

  const text = document.createElement("span");
  text.textContent = message;
  toast.appendChild(text);

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

export function animateProgress() {
  const circle = document.getElementById("progress-circle");
  if (!circle) return;
  const total = 150.796;
  let offset = total;
  const interval = setInterval(() => {
    offset -= 3;
    if (offset <= 0) {
      clearInterval(interval);
      return;
    }
    circle.style.strokeDashoffset = offset;
  }, 40);
}
