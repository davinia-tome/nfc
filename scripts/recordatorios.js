/* =========================================================
   recordatorios.js
   Script ejecutado por GitHub Actions (ver .github/workflows/recordatorios.yml).
   1. Consulta Supabase (REST) los productos pendientes.
   2. Filtra los que llevan MÁS de N días (por defecto 5) sin comprar.
   3. Si hay productos antiguos, envía un email de recordatorio por SMTP.

   Requiere estas variables de entorno (definidas como GitHub Secrets):
     - SUPABASE_URL        URL del proyecto Supabase
     - SUPABASE_KEY        Service role key (o anon con RLS de lectura)
     - SMTP_HOST           Servidor SMTP (ej: smtp.gmail.com)
     - SMTP_PORT           Puerto SMTP (ej: 465 SSL / 587 TLS)
     - SMTP_USER           Usuario / dirección del remitente
     - SMTP_PASS           Contraseña o "App Password"
     - MAIL_TO             Destinatario del recordatorio
   Opcional:
     - DIAS_ANTIGUEDAD     Umbral de días (por defecto 5)
   ========================================================= */

const nodemailer = require("nodemailer");

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  MAIL_TO,
  DIAS_ANTIGUEDAD,
} = process.env;

const TABLE = "lista_compra";
const DIAS = parseInt(DIAS_ANTIGUEDAD || "5", 10);

function requireEnv(pairs) {
  const missing = Object.entries(pairs)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error("Faltan variables de entorno:", missing.join(", "));
    process.exit(1);
  }
}

/** Recupera productos pendientes creados hace más de DIAS días. */
async function fetchOldItems() {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - DIAS);
  const isoThreshold = threshold.toISOString();

  // PostgREST: filtros comprado=false y created_at < umbral
  const url =
    `${SUPABASE_URL}/rest/v1/${TABLE}` +
    `?select=id,producto,unidades,created_at` +
    `&comprado=eq.false` +
    `&created_at=lt.${encodeURIComponent(isoThreshold)}` +
    `&order=created_at.asc`;

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase respondió ${res.status}: ${body}`);
  }
  return res.json();
}

function buildEmail(items) {
  const daysAgo = (iso) => {
    const diffMs = Date.now() - new Date(iso).getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  };

  const rows = items
    .map((it) => {
      const name = it.producto.charAt(0).toUpperCase() + it.producto.slice(1);
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${it.unidades}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${daysAgo(it.created_at)} días</td>
      </tr>`;
    })
    .join("");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;">
      <h2 style="color:#2e7d32;">🛒 Recordatorio de la lista de la compra</h2>
      <p>Tienes <strong>${items.length}</strong> producto(s) que llevan más de
      ${DIAS} días pendientes en tu lista:</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="background:#e8f5e9;">
            <th style="padding:8px 12px;text-align:left;">Producto</th>
            <th style="padding:8px 12px;">Unidades</th>
            <th style="padding:8px 12px;">Antigüedad</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#5f6b76;font-size:13px;margin-top:20px;">
        Este es un aviso automático generado por GitHub Actions.
      </p>
    </div>`;

  const text = items
    .map((it) => `- ${it.producto} (${it.unidades}) — ${daysAgo(it.created_at)} días`)
    .join("\n");

  return { html, text };
}

async function sendEmail(items) {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || "465", 10),
    secure: parseInt(SMTP_PORT || "465", 10) === 465, // true para 465, false para 587
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const { html, text } = buildEmail(items);

  const info = await transporter.sendMail({
    from: `"Lista de la Compra" <${SMTP_USER}>`,
    to: MAIL_TO,
    subject: `🛒 ${items.length} producto(s) llevan más de ${DIAS} días en tu lista`,
    text,
    html,
  });

  console.log("Email enviado:", info.messageId);
}

async function main() {
  requireEnv({ SUPABASE_URL, SUPABASE_KEY });

  const items = await fetchOldItems();
  console.log(`Productos con más de ${DIAS} días: ${items.length}`);

  if (!items.length) {
    console.log("No hay productos antiguos. No se envía email.");
    return;
  }

  requireEnv({ SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_TO });
  await sendEmail(items);
}

main().catch((err) => {
  console.error("Error en el recordatorio:", err);
  process.exit(1);
});
