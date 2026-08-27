# 🛒 Lista de la Compra por Etiquetas NFC

Aplicación web ligera (Single Page Application) alojada en **GitHub Pages** que
se abre al escanear una etiqueta **NFC** desde cualquier smartphone. Permite
añadir productos a una lista de la compra, gestionarlos y recibir recordatorios
por email de los productos que llevan demasiado tiempo pendientes.

- **Frontend:** HTML + CSS + JavaScript puro (sin build, sin frameworks).
- **Backend / almacenamiento:** [Supabase](https://supabase.com) (PostgreSQL + API REST).
- **Automatización:** GitHub Actions (recordatorios por email vía cron).

---

## 📁 Estructura del proyecto

```text
nfc/
├── lista-compra/
│   ├── index.html          # Estructura de la SPA + config de Supabase
│   ├── style.css           # Estilos móvil-first (modales, toasts, etc.)
│   └── script.js           # Lógica: URL params, CRUD Supabase, vistas
├── scripts/
│   ├── recordatorios.js    # Script Node que consulta Supabase y envía email
│   └── package.json        # Dependencia: nodemailer
├── .github/
│   └── workflows/
│       └── recordatorios.yml   # Workflow diario + ejecución manual
└── README.md
```

---

## 🗄️ ¿Dónde guardar la lista? (opciones de almacenamiento)

Como GitHub Pages solo sirve archivos **estáticos**, no puede guardar datos por
sí mismo. Estas son las opciones, de menos a más recomendada para este caso:

| Opción | Persistencia | Multi-dispositivo | Complejidad | Notas |
|--------|-------------|-------------------|-------------|-------|
| `localStorage` del navegador | Sí (local) | ❌ No | Muy baja | Cada móvil tendría su propia lista; se pierde al borrar datos. |
| Commits vía GitHub Actions a un `data.json` | Sí | ✅ Sí | Media/alta | Lento, "hacky", condiciones de carrera al escribir. |
| **Supabase (elegido)** | Sí | ✅ Sí | Baja | Base de datos real, API REST lista para usar, capa gratuita amplia. |
| Firebase / otro BaaS | Sí | ✅ Sí | Baja | Alternativa equivalente a Supabase. |

**Recomendación:** Supabase. Ofrece una base de datos PostgreSQL con API REST
automática y una capa gratuita más que suficiente para una lista de la compra.
Esta implementación ya está preparada para Supabase.

> ⚠️ **Seguridad:** la `anon key` se incrusta en el JavaScript del navegador y,
> por tanto, es **pública**. Esto es normal en Supabase, pero **debes activar
> Row Level Security (RLS)** con políticas que limiten qué se puede hacer con
> esa clave (ver más abajo). Sin RLS, cualquiera con la URL podría leer/escribir
> tu tabla.

---

## 🚀 Puesta en marcha

### 1. Crear el proyecto en Supabase

1. Entra en <https://supabase.com> y crea un proyecto (gratis).
2. Ve a **SQL Editor** y ejecuta el siguiente script para crear la tabla:

```sql
-- Tabla principal de la lista de la compra
create table if not exists public.lista_compra (
  id          bigint generated always as identity primary key,
  producto    text        not null,
  unidades    integer     not null default 1,
  comprado    boolean     not null default false,
  created_at  timestamptz not null default now()
);

-- Índice para acelerar las consultas por estado
create index if not exists idx_lista_compra_pendientes
  on public.lista_compra (comprado, created_at);

-- Activar Row Level Security (IMPRESCINDIBLE)
alter table public.lista_compra enable row level security;

-- Política: permitir a la clave pública (anon) leer y escribir.
-- Ajusta esto si quieres restringir más el acceso.
create policy "acceso_publico_lista"
  on public.lista_compra
  for all
  to anon
  using (true)
  with check (true);
```

> El enunciado pedía los campos `id, producto, unidades, created_at`. Se añade
> además `comprado` (boolean) porque la app lo necesita para separar los
> productos pendientes de los ya comprados.

3. Ve a **Project Settings → API** y copia:
   - **Project URL** → `SUPABASE_URL`
   - **anon public key** → para el frontend
   - **service_role key** → para el workflow de recordatorios (secreta)

### 2. Configurar el frontend

Edita `lista-compra/index.html` y sustituye los valores del bloque
`SUPABASE_CONFIG`:

```html
<script>
  window.SUPABASE_CONFIG = {
    url: "https://TU_PROYECTO.supabase.co",
    anonKey: "TU_ANON_KEY_PUBLICA"
  };
</script>
```

> Usa la **anon key** aquí (no la service_role). La app muestra un mensaje de
> "Configuración pendiente" mientras estos valores no se rellenen.

### 3. Activar GitHub Pages

En el repositorio `nfc` de GitHub:

1. Ve a **Settings → Pages**.
2. En **Source**, elige **Deploy from a branch**.
3. En **Branch**, selecciona **`main`** y carpeta **`/ (root)`**.
4. Pulsa **Save**.

Tras unos minutos la app estará disponible en:

```
https://<usuario>.github.io/nfc/lista-compra/
```

*(Sustituye `<usuario>` por tu nombre de usuario de GitHub.)*

### 4. Configurar los Secrets para los recordatorios

En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**.
Crea los siguientes secrets:

| Secret | Descripción | Ejemplo |
|--------|-------------|---------|
| `SUPABASE_URL` | URL del proyecto Supabase | `https://xxxx.supabase.co` |
| `SUPABASE_KEY` | **service_role key** (o anon con permiso de lectura vía RLS) | `eyJ...` |
| `SMTP_HOST` | Servidor SMTP del correo | `smtp.gmail.com` |
| `SMTP_PORT` | Puerto SMTP (`465` SSL o `587` TLS) | `465` |
| `SMTP_USER` | Dirección del remitente | `tucorreo@gmail.com` |
| `SMTP_PASS` | Contraseña o **App Password** | `abcd efgh ijkl mnop` |
| `MAIL_TO` | Destinatario del recordatorio | `tucorreo@gmail.com` |

> **Gmail:** activa la verificación en dos pasos y genera una
> [App Password](https://myaccount.google.com/apppasswords). Usa esa contraseña
> de 16 caracteres en `SMTP_PASS`, no tu contraseña normal.

---

## ⏰ Automatización de recordatorios

El workflow `.github/workflows/recordatorios.yml`:

- Se ejecuta **cada día a las 09:00 UTC** (`cron: "0 9 * * *"`).
- Se puede lanzar **manualmente** desde la pestaña **Actions → Recordatorios → Run workflow** (`workflow_dispatch`).
- Ejecuta `scripts/recordatorios.js`, que:
  1. Consulta la API REST de Supabase.
  2. Filtra los productos pendientes (`comprado = false`) con `created_at` de hace **más de 5 días** (configurable con `DIAS_ANTIGUEDAD`).
  3. Si hay productos antiguos, envía un email HTML con la lista.

Puedes probarlo en local:

```bash
cd scripts
npm install
SUPABASE_URL=... SUPABASE_KEY=... SMTP_HOST=... SMTP_PORT=465 \
SMTP_USER=... SMTP_PASS=... MAIL_TO=... node recordatorios.js
```

---

## 🏷️ URLs para grabar en las etiquetas NFC

Graba estas URLs en tus etiquetas con cualquier app de escritura NFC
(ej. *NFC Tools*). Sustituye `<usuario>` por tu usuario de GitHub.

**Vista general de la lista** (etiqueta en la nevera, la puerta, etc.):

```
https://<usuario>.github.io/nfc/lista-compra/
```

**Etiquetas individuales de producto** (una por producto):

```
https://<usuario>.github.io/nfc/lista-compra/?item=leche
https://<usuario>.github.io/nfc/lista-compra/?item=pan
https://<usuario>.github.io/nfc/lista-compra/?item=huevos
https://<usuario>.github.io/nfc/lista-compra/?item=cafe
https://<usuario>.github.io/nfc/lista-compra/?item=papel%20higienico
```

> Para nombres con espacios, usa `%20` (ej. `?item=papel%20higienico`).
> Los acentos se normalizan automáticamente al buscar en la base de datos.

**Etiqueta "Otros" (añadir por voz)** — para productos poco habituales:

```
https://<usuario>.github.io/nfc/lista-compra/?item=otros
```

Al escanearla, en lugar de un producto fijo, la app pregunta *"¿Qué producto
quieres añadir?"* y permite dictarlo **por voz** (o escribirlo). Después pide las
unidades como con cualquier otro producto. Palabras reservadas para esta pegatina:
`otros`, `otro`, `varios`.

> El dictado por voz usa la Web Speech API del navegador: funciona en Chrome y en
> Android sobre HTTPS (requiere dar permiso de micrófono). En iOS/Safari el soporte
> es limitado, por eso siempre hay un campo de texto como alternativa.

---

## 🔄 Cómo funciona la app

### Al escanear una etiqueta de producto (`?item=leche`)

1. Normaliza el nombre (minúsculas, sin acentos).
2. Consulta la tabla `lista_compra`.
3. **Si NO existe:** muestra un modal *"¿Cuántas unidades de Leche quieres añadir?"*
   con un selector de unidades y el botón **Añadir a la lista**.
4. **Si YA existe:** muestra el aviso *"El producto Leche ya está en la lista (N unidades)"*
   con las opciones **Modificar unidades** y **Eliminar de la lista**.

### Vista general (sin `?item=`)

1. Carga todos los productos con `comprado = false`.
2. Muestra un listado con checkbox y unidades.
3. El botón fijo **Compra Hecha** elimina únicamente los productos marcados y
   conserva el resto, refrescando la vista.

---

## 🧪 Probar en local

```bash
cd lista-compra
python3 -m http.server 8000
# Abre http://localhost:8000/  (necesitas rellenar SUPABASE_CONFIG en index.html)
```
