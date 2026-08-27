/* =========================================================
   Lista de la Compra — lógica de la aplicación (SPA)
   - Lee ?item=... de la URL para el flujo de escaneo NFC.
   - Sin parámetro: muestra la vista general de la lista.
   - Backend: Supabase (tabla "lista_compra").
   ========================================================= */

"use strict";

/* ---------------------------------------------------------
   1. Inicialización de Supabase
   --------------------------------------------------------- */
const CONFIG = window.SUPABASE_CONFIG || {};
const TABLE = "lista_compra";

let supabase = null;
let configOk = false;

if (
  CONFIG.url &&
  CONFIG.anonKey &&
  !CONFIG.url.includes("TU_PROYECTO") &&
  !CONFIG.anonKey.includes("TU_ANON_KEY")
) {
  supabase = window.supabase.createClient(CONFIG.url, CONFIG.anonKey);
  configOk = true;
}

/* ---------------------------------------------------------
   2. Referencias al DOM y utilidades
   --------------------------------------------------------- */
const $viewRoot = document.getElementById("view-root");
const $floating = document.getElementById("floating-actions");
const $btnCompraHecha = document.getElementById("btn-compra-hecha");
const $modalOverlay = document.getElementById("modal-overlay");
const $modalBox = document.getElementById("modal-box");
const $toastContainer = document.getElementById("toast-container");
const $loading = document.getElementById("loading-overlay");

/** Normaliza un nombre: minúsculas, sin acentos, sin espacios extra. */
function normalize(str) {
  return (str || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Capitaliza la primera letra para mostrar. */
function displayName(str) {
  const s = (str || "").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Devuelve el valor del parámetro ?item= de la URL (o null). */
function getItemParam() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("item");
  return raw ? raw.trim() : null;
}

/* ---------------------------------------------------------
   3. Feedback visual: loading, toasts, modal
   --------------------------------------------------------- */
function showLoading(show) {
  $loading.classList.toggle("hidden", !show);
}

function toast(message, type = "info", ms = 2800) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  $toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.25s ease";
    setTimeout(() => el.remove(), 250);
  }, ms);
}

function openModal(html) {
  $modalBox.innerHTML = html;
  $modalOverlay.classList.remove("hidden");
}

function closeModal() {
  $modalOverlay.classList.add("hidden");
  $modalBox.innerHTML = "";
}

// Cerrar modal al tocar el fondo oscuro
$modalOverlay.addEventListener("click", (e) => {
  if (e.target === $modalOverlay) closeModal();
});

/* ---------------------------------------------------------
   4. Capa de acceso a datos (Supabase)
   --------------------------------------------------------- */

/** Busca un producto (por nombre normalizado) que no esté comprado. */
async function findProduct(normalizedName) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("producto", normalizedName)
    .eq("comprado", false)
    .limit(1);
  if (error) throw error;
  return data && data.length ? data[0] : null;
}

async function insertProduct(normalizedName, unidades) {
  const { error } = await supabase.from(TABLE).insert({
    producto: normalizedName,
    unidades: unidades,
    comprado: false,
  });
  if (error) throw error;
}

async function updateUnits(id, unidades) {
  const { error } = await supabase
    .from(TABLE)
    .update({ unidades: unidades })
    .eq("id", id);
  if (error) throw error;
}

async function deleteProduct(id) {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}

async function deleteMany(ids) {
  if (!ids.length) return;
  const { error } = await supabase.from(TABLE).delete().in("id", ids);
  if (error) throw error;
}

/** Carga todos los productos pendientes (comprado = false). */
async function fetchPending() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("comprado", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

/* ---------------------------------------------------------
   5. Vista A — Flujo de escaneo de etiqueta (?item=)
   --------------------------------------------------------- */
async function renderItemFlow(rawItem) {
  const normalized = normalize(rawItem);
  const nice = displayName(rawItem);

  $floating.classList.add("hidden");
  $viewRoot.innerHTML = `
    <div class="card">
      <p class="muted">Producto escaneado</p>
      <h2 class="section-title" style="text-transform: capitalize;">${nice}</h2>
      <p class="muted">Comprobando la lista…</p>
    </div>`;

  showLoading(true);
  try {
    const existing = await findProduct(normalized);
    showLoading(false);
    if (existing) {
      renderExistingModal(existing, nice);
    } else {
      renderAddModal(normalized, nice);
    }
  } catch (err) {
    showLoading(false);
    console.error(err);
    toast("Error al consultar la lista", "error");
    renderErrorCard();
  }
}

/** Modal: el producto NO existe → añadir con selector de unidades. */
function renderAddModal(normalizedName, nice) {
  openModal(`
    <h2>Añadir producto</h2>
    <p>¿Cuántas unidades de <span class="product-name">${nice}</span> quieres añadir?</p>
    <div class="stepper">
      <button class="stepper-btn" id="dec" aria-label="Menos">−</button>
      <span class="stepper-value" id="qty">1</span>
      <button class="stepper-btn" id="inc" aria-label="Más">+</button>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="cancel">Cancelar</button>
      <button class="btn btn-primary" id="confirm">Añadir a la lista</button>
    </div>
  `);

  let qty = 1;
  const $qty = document.getElementById("qty");
  document.getElementById("inc").onclick = () => { qty++; $qty.textContent = qty; };
  document.getElementById("dec").onclick = () => { if (qty > 1) { qty--; $qty.textContent = qty; } };
  document.getElementById("cancel").onclick = goToOverview;
  document.getElementById("confirm").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span>';
    try {
      await insertProduct(normalizedName, qty);
      closeModal();
      toast(`${nice} añadido (${qty})`, "success");
      goToOverview();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = "Añadir a la lista";
      toast("No se pudo añadir el producto", "error");
    }
  };
}

/** Modal: el producto YA existe → modificar unidades o eliminar. */
function renderExistingModal(item, nice) {
  openModal(`
    <span class="badge badge-warning">Ya en la lista</span>
    <h2 style="margin-top:10px;">Producto duplicado</h2>
    <p>El producto <span class="product-name">${nice}</span> ya está en la lista
       (<strong>${item.unidades}</strong> ${item.unidades === 1 ? "unidad" : "unidades"}).</p>
    <div class="stepper">
      <button class="stepper-btn" id="dec" aria-label="Menos">−</button>
      <span class="stepper-value" id="qty">${item.unidades}</span>
      <button class="stepper-btn" id="inc" aria-label="Más">+</button>
    </div>
    <div class="btn-row" style="margin-bottom:12px;">
      <button class="btn btn-accent" id="modify">Modificar unidades</button>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="cancel">Cancelar</button>
      <button class="btn btn-danger" id="remove">Eliminar de la lista</button>
    </div>
  `);

  let qty = item.unidades;
  const $qty = document.getElementById("qty");
  document.getElementById("inc").onclick = () => { qty++; $qty.textContent = qty; };
  document.getElementById("dec").onclick = () => { if (qty > 1) { qty--; $qty.textContent = qty; } };
  document.getElementById("cancel").onclick = goToOverview;

  document.getElementById("modify").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span>';
    try {
      await updateUnits(item.id, qty);
      closeModal();
      toast(`${nice} actualizado (${qty})`, "success");
      goToOverview();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = "Modificar unidades";
      toast("No se pudo actualizar", "error");
    }
  };

  document.getElementById("remove").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span>';
    try {
      await deleteProduct(item.id);
      closeModal();
      toast(`${nice} eliminado`, "info");
      goToOverview();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = "Eliminar de la lista";
      toast("No se pudo eliminar", "error");
    }
  };
}

/* ---------------------------------------------------------
   6. Vista B — Vista general de la lista
   --------------------------------------------------------- */
async function renderOverview() {
  closeModal();
  $viewRoot.innerHTML = `
    <div class="card">
      <h2 class="section-title">Tu lista de la compra</h2>
      <p class="muted">Cargando…</p>
    </div>`;
  $floating.classList.add("hidden");

  showLoading(true);
  try {
    const items = await fetchPending();
    showLoading(false);
    paintOverview(items);
  } catch (err) {
    showLoading(false);
    console.error(err);
    toast("Error al cargar la lista", "error");
    renderErrorCard();
  }
}

function paintOverview(items) {
  if (!items.length) {
    $viewRoot.innerHTML = `
      <div class="empty-state">
        <span class="emoji">🎉</span>
        <h2>La lista está vacía</h2>
        <p class="muted">Escanea una etiqueta NFC para añadir productos.</p>
      </div>`;
    $floating.classList.add("hidden");
    return;
  }

  const rows = items
    .map(
      (it) => `
      <li class="item" data-id="${it.id}">
        <input type="checkbox" class="item-check" data-id="${it.id}" aria-label="Marcar ${displayName(it.producto)}" />
        <div class="item-body">
          <div class="item-name">${displayName(it.producto)}</div>
          <div class="item-qty">${it.unidades} ${it.unidades === 1 ? "unidad" : "unidades"}</div>
        </div>
      </li>`
    )
    .join("");

  $viewRoot.innerHTML = `
    <h2 class="section-title">Tu lista (${items.length})</h2>
    <ul class="item-list">${rows}</ul>`;

  // Marcar/desmarcar visualmente
  $viewRoot.querySelectorAll(".item-check").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      e.target.closest(".item").classList.toggle("checked", e.target.checked);
    });
  });

  $floating.classList.remove("hidden");
}

/** Botón "Compra Hecha": elimina solo los productos marcados. */
$btnCompraHecha.addEventListener("click", async () => {
  const checked = Array.from(
    $viewRoot.querySelectorAll(".item-check:checked")
  ).map((cb) => parseInt(cb.dataset.id, 10));

  if (!checked.length) {
    toast("Marca primero los productos comprados", "info");
    return;
  }

  $btnCompraHecha.disabled = true;
  $btnCompraHecha.innerHTML = '<span class="btn-spinner"></span>';
  try {
    await deleteMany(checked);
    toast(`${checked.length} producto(s) comprado(s)`, "success");
    await renderOverview();
  } catch (err) {
    console.error(err);
    toast("No se pudo completar la compra", "error");
  } finally {
    $btnCompraHecha.disabled = false;
    $btnCompraHecha.innerHTML = "✅ Compra Hecha";
  }
});

/* ---------------------------------------------------------
   7. Navegación / helpers
   --------------------------------------------------------- */

/** Va a la vista general limpiando el parámetro ?item de la URL. */
function goToOverview() {
  closeModal();
  const clean = window.location.origin + window.location.pathname;
  window.history.replaceState({}, "", clean);
  renderOverview();
}

function renderErrorCard() {
  $viewRoot.innerHTML = `
    <div class="empty-state">
      <span class="emoji">⚠️</span>
      <h2>Algo salió mal</h2>
      <p class="muted">Revisa tu conexión y la configuración de Supabase.</p>
      <button class="btn btn-primary" style="margin-top:16px;" onclick="location.reload()">Reintentar</button>
    </div>`;
}

function renderConfigError() {
  $viewRoot.innerHTML = `
    <div class="empty-state">
      <span class="emoji">🔧</span>
      <h2>Configuración pendiente</h2>
      <p class="muted">Falta configurar Supabase. Edita las variables
      <code>SUPABASE_CONFIG</code> en <code>index.html</code>.
      Consulta el README para más detalles.</p>
    </div>`;
}

/* ---------------------------------------------------------
   8. Arranque de la aplicación
   --------------------------------------------------------- */
function main() {
  if (!configOk) {
    renderConfigError();
    return;
  }
  const item = getItemParam();
  if (item) {
    renderItemFlow(item);
  } else {
    renderOverview();
  }
}

document.addEventListener("DOMContentLoaded", main);
