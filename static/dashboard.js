/* ============================================================
   SmartStock Dashboard — dashboard.js (mejorado)
   Vanilla JS sin frameworks. Chart.js via CDN.
   ============================================================ */

'use strict';

// ── Configuración ──────────────────────────────────────────
const API_BASE = '';
const TOP_SKU_LIMIT = 10;

// ── Estado global ──────────────────────────────────────────
let currentDays = 30;
let demandChart = null;

// ── Utils ──────────────────────────────────────────────────
const fmt = {
  num: v => Number(v).toLocaleString('en-US'),
  money: v => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  decimal: v => Number(v).toFixed(3),
};

function now() {
  return new Date().toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Fetch helper con manejo de errores ─────────────────────
async function apiFetch(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Error ${res.status} on ${path}`);
  }
  return res.json();
}

// ── Spinner helpers ────────────────────────────────────────
function spinnerHTML() {
  return '<span class="spinner"></span>';
}

function setLoading(el, loading) {
  if (loading) {
    el.style.opacity = '0.6';
    el.style.pointerEvents = 'none';
  } else {
    el.style.opacity = '1';
    el.style.pointerEvents = '';
  }
}

// ── Mostrar error inline ───────────────────────────────────
function showError(containerId, msg) {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `<div class="error-banner">⚠ ${escapeHtml(msg)}</div>`;
  }
}

// ── Actualizar KPIs con animación ──────────────────────────
function animateValue(element, start, end, duration = 600) {
  const startTime = performance.now();
  const isNumber = typeof end === 'number';
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    
    if (isNumber) {
      const current = Math.round(start + (end - start) * easeProgress);
      element.textContent = fmt.num(current);
    }
    
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

function renderKPIs(demand, inventory) {
  const critical = inventory.filter(i => i.stock < 10).length;
  
  const kpiCritical = document.getElementById('kpi-critical');
  const kpiUnits = document.getElementById('kpi-units');
  const kpiRevenue = document.getElementById('kpi-revenue');
  const kpiWindow = document.getElementById('kpi-window');
  
  // Animate numbers
  const prevCritical = parseInt(kpiCritical.textContent) || 0;
  const prevUnits = parseInt(kpiUnits.textContent.replace(/,/g, '')) || 0;
  
  animateValue(kpiCritical, prevCritical, critical);
  animateValue(kpiUnits, prevUnits, demand.total_units_sold);
  
  kpiRevenue.textContent = fmt.money(demand.total_revenue);
  kpiWindow.textContent = `Last ${demand.window_days} days · ref ${demand.ref_date}`;
}

// ── Gráfico de barras: top SKUs ────────────────────────────
function renderChart(demand) {
  const bySkuTop = demand.by_sku.slice(0, TOP_SKU_LIMIT);

  const labels = bySkuTop.map(d => d.name || d.sku);
  const data = bySkuTop.map(d => d.units_sold);
  
  // Modern gradient colors
  const colors = bySkuTop.map((_, i) => {
    const t = i / Math.max(bySkuTop.length - 1, 1);
    const hue = 35 - (t * 15); // amber to orange
    return `hsla(${hue}, 95%, 55%, 0.85)`;
  });

  const ctx = document.getElementById('demand-chart').getContext('2d');

  if (demandChart) {
    demandChart.destroy();
  }

  demandChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Units sold',
        data,
        backgroundColor: colors,
        borderColor: colors.map(c => c.replace('0.85', '1')),
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 800,
        easing: 'easeOutQuart'
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1d22',
          borderColor: '#3a4050',
          borderWidth: 1,
          titleColor: '#94a3b8',
          bodyColor: '#f1f5f9',
          padding: 12,
          cornerRadius: 8,
          displayColors: false,
          titleFont: {
            family: "'JetBrains Mono', monospace",
            size: 11,
          },
          bodyFont: {
            family: "'Inter', sans-serif",
            size: 13,
            weight: '600'
          },
          callbacks: {
            title: ctx => ctx[0].label,
            label: ctx => `${fmt.num(ctx.parsed.y)} units`,
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#64748b',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            maxRotation: 45,
            minRotation: 0,
          },
          grid: { 
            color: '#2a2e35',
            drawBorder: false,
          }
        },
        y: {
          ticks: {
            color: '#64748b',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            padding: 8,
          },
          grid: { 
            color: '#2a2e35',
            drawBorder: false,
          }
        }
      }
    }
  });
}

// ── Tabla de inventario ────────────────────────────────────
function renderInventoryTable(inventory) {
  const tbody = document.querySelector('#inventory-table tbody');

  if (!inventory.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No inventory data.</td></tr>';
    return;
  }

  tbody.innerHTML = inventory.map((item, index) => {
    const riskClass = item.stockout_risk ? 'high' : 'ok';
    const riskLabel = item.stockout_risk ? '⚠ Risk' : '✓ OK';
    return `
      <tr style="animation: fadeInRow 0.3s ease ${index * 0.02}s both">
        <td><code>${escapeHtml(item.sku)}</code></td>
        <td class="name-col">${escapeHtml(item.name)}</td>
        <td>${fmt.num(item.stock)}</td>
        <td>${fmt.decimal(item.avg_daily_demand)}</td>
        <td>${item.lead_time_days} days</td>
        <td><span class="badge-risk ${riskClass}">${riskLabel}</span></td>
      </tr>`;
  }).join('');
  
  // Add animation keyframes if not present
  if (!document.getElementById('table-animations')) {
    const style = document.createElement('style');
    style.id = 'table-animations';
    style.textContent = `
      @keyframes fadeInRow {
        from { opacity: 0; transform: translateX(-8px); }
        to { opacity: 1; transform: translateX(0); }
      }
    `;
    document.head.appendChild(style);
  }
}

// ── Panel Reorden ──────────────────────────────────────────
function renderReorden(inventory) {
  const atRisk = inventory.filter(i => i.stockout_risk);
  const list = document.getElementById('reorden-list');
  const badge = document.getElementById('reorden-badge');

  badge.textContent = atRisk.length;

  if (!atRisk.length) {
    list.innerHTML = '<div class="empty-state">✓ No SKUs at risk of stockout.</div>';
    return;
  }

  list.innerHTML = atRisk.map((item, index) => `
      <div class="reorden-item" style="animation: fadeInRow 0.3s ease ${index * 0.05}s both">
      <span class="reorden-sku">${escapeHtml(item.sku)}</span>
      <span class="reorden-name">${escapeHtml(item.name)}</span>
      <div class="reorden-meta">
        <span>Stock: ${item.stock}</span>
        <span>Demand/day: ${fmt.decimal(item.avg_daily_demand)}</span>
        <span>Lead: ${item.lead_time_days}d</span>
      </div>
      <button class="btn-ver-proveedor" data-supplier="${item.supplier_id}" data-name="${escapeHtml(item.name)}">
        View supplier →
      </button>
    </div>
  `).join('');

  // Delegate events
  list.querySelectorAll('.btn-ver-proveedor').forEach(btn => {
    btn.addEventListener('click', () => {
      openSupplierModal(btn.dataset.supplier, btn.dataset.name);
    });
  });
}

// ── Modal proveedor ────────────────────────────────────────
async function openSupplierModal(supplierId, productName) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  const title = document.getElementById('modal-title');

  title.textContent = `Supplier — ${productName}`;
  content.innerHTML = `<div style="text-align: center; padding: 2rem;">${spinnerHTML()} Loading...</div>`;
  overlay.style.display = 'flex';

  // Close handlers
  const close = () => {
    overlay.style.display = 'none';
  };

  document.getElementById('modal-close').onclick = close;
  overlay.onclick = e => {
    if (e.target === overlay) close();
  };

  // Close on Escape key
  const escHandler = e => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  try {
    const sup = await apiFetch(`/suppliers/${supplierId}`);
    content.innerHTML = `
      <div class="sup-field"><span class="sup-key">ID</span><span class="sup-val">${sup.SupplierID || sup.supplier_id || '—'}</span></div>
      <div class="sup-field"><span class="sup-key">Name</span><span class="sup-val">${sup.SupplierName || sup.name || '—'}</span></div>
      <div class="sup-field"><span class="sup-key">Email</span><span class="sup-val">${sup.Email || sup.email || '—'}</span></div>
      <div class="sup-field"><span class="sup-key">Phone</span><span class="sup-val">${sup.Phone || sup.phone || '—'}</span></div>
      <div class="sup-field"><span class="sup-key">Address</span><span class="sup-val">${sup.Address || sup.address || '—'}</span></div>
      <div class="sup-field"><span class="sup-key">Website</span><span class="sup-val">${sup.Website || sup.website || '—'}</span></div>
      <div class="sup-field"><span class="sup-key">Lead time</span><span class="sup-val">${sup.LeadTime || sup.lead_time || '—'} days</span></div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="error-banner">⚠ Could not load supplier: ${escapeHtml(err.message)}</div>`;
  }
}

// ── Carga principal de datos ───────────────────────────────
async function loadDashboard(days) {
  const btn = document.getElementById('btn-actualizar');
  const btnContent = btn.innerHTML;
  
  btn.disabled = true;
  btn.innerHTML = `${spinnerHTML()} <span>Refreshing...</span>`;

  // Loading state for KPIs
  const kpis = ['kpi-critical', 'kpi-units', 'kpi-revenue'];
  kpis.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = spinnerHTML();
  });

  try {
    const [demand, inventory] = await Promise.all([
      apiFetch(`/demand?days=${days}`),
      apiFetch('/inventory'),
    ]);

    renderKPIs(demand, inventory);
    renderChart(demand);
    renderInventoryTable(inventory);
    renderReorden(inventory);

    const lastUpdate = document.getElementById('last-update');
    lastUpdate.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      <span>${now()}</span>
    `;
    
  } catch (err) {
    kpis.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    showError('inventory-table-wrap', err.message);
    showError('reorden-list', err.message);
    console.error('[SmartStock]', err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = btnContent;
  }
}

// ── Inicialización ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Selector de días (botones preset)
  document.querySelectorAll('.btn-group button[data-days]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-group button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentDays = parseInt(btn.dataset.days, 10);
      document.getElementById('custom-days').value = '';
      loadDashboard(currentDays);
    });
  });

  // Activate 30d button by default
  document.querySelector('.btn-group button[data-days="30"]')?.classList.add('active');

  // Custom days input
  const customInput = document.getElementById('custom-days');
  const btnCustom = document.getElementById('btn-custom-days');

  btnCustom.addEventListener('click', () => {
    const val = parseInt(customInput.value, 10);
    if (isNaN(val) || val < 1 || val > 365) {
      customInput.style.borderColor = '#ef4444';
      customInput.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.15)';
      return;
    }
    customInput.style.borderColor = '';
    customInput.style.boxShadow = '';
    document.querySelectorAll('.btn-group button').forEach(b => b.classList.remove('active'));
    currentDays = val;
    loadDashboard(currentDays);
  });

  customInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') btnCustom.click();
  });

  customInput.addEventListener('input', () => {
    customInput.style.borderColor = '';
    customInput.style.boxShadow = '';
  });

  // Refresh button
  document.getElementById('btn-actualizar').addEventListener('click', () => {
    loadDashboard(currentDays);
  });

  // Initial load
  loadDashboard(currentDays);
});
