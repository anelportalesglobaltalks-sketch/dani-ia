/**
 * GT Buscador — busca en Drive, LEE el contenido de los
 * documentos (Google Docs / Sheets) y responde con Gemini.
 *
 * Variables de entorno: GDRIVE_SA_KEY, GEMINI_API_KEY,
 * GDRIVE_ROOT_FOLDER_ID
 */
import { google } from "googleapis";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = { maxDuration: 30 };

const MIME_DOC = "application/vnd.google-apps.document";
const MIME_SHEET = "application/vnd.google-apps.spreadsheet";
const MAX_DOCS_A_LEER = 3;
const MAX_CHARS_POR_DOC = 6000;

/* ---------- utilidades ---------- */

// Quita asteriscos, almohadillas y otros restos de markdown.
function limpiarTexto(t) {
  if (typeof t !== "string") return "";
  return t
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .trim();
}

function dividirEnBloques(arr, tamano) {
  const bloques = [];
  for (let i = 0; i < arr.length; i += tamano) bloques.push(arr.slice(i, i + tamano));
  return bloques;
}

function crearDrive(saKeyJson) {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(saKeyJson),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

/* ---------- Drive: búsqueda ---------- */

// IDs de la carpeta y de todas sus subcarpetas, nivel por nivel en paralelo.
async function recolectarSubcarpetas(drive, rootId) {
  const todos = [rootId];
  let nivel = [rootId];
  while (nivel.length > 0) {
    const respuestas = await Promise.all(
      nivel.map((id) =>
        drive.files.list({
          q: `'${id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: "files(id)",
          pageSize: 100,
        })
      )
    );
    nivel = respuestas.flatMap((r) => (r.data.files || []).map((f) => f.id));
    todos.push(...nivel);
  }
  return todos;
}

const CAMPOS = "files(id, name, webViewLink, mimeType)";

function aResultado(f) {
  return {
    source: "drive",
    id: f.id,
    title: f.name,
    url: f.webViewLink,
    mimeType: f.mimeType,
  };
}

async function ejecutarBusquedaDrive(drive, query, folderId) {
  const texto = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const baseQ = `fullText contains '${texto}' and trashed = false`;

  if (!folderId) {
    const r = await drive.files.list({ q: baseQ, fields: CAMPOS, pageSize: 8 });
    return (r.data.files || []).map(aResultado);
  }

  // Con filtro: se parte la lista de carpetas en bloques para no pasar el
  // límite de largo de la consulta (error 400).
  const ids = await recolectarSubcarpetas(drive, folderId);
  const respuestas = await Promise.all(
    dividirEnBloques(ids, 20).map((bloque) =>
      drive.files.list({
        q: `${baseQ} and (${bloque.map((id) => `'${id}' in parents`).join(" or ")})`,
        fields: CAMPOS,
        pageSize: 8,
      })
    )
  );

  const vistos = new Set();
  const archivos = [];
  for (const r of respuestas) {
    for (const f of r.data.files || []) {
      if (!vistos.has(f.id)) {
        vistos.add(f.id);
        archivos.push(f);
      }
    }
  }
  return archivos.slice(0, 8).map(aResultado);
}

async function searchDrive(drive, query, folderId) {
  if (!drive) return { resultados: [], fueraDelFiltro: false };
  try {
    const filtrados = await ejecutarBusquedaDrive(drive, query, folderId);
    if (folderId && filtrados.length === 0) {
      const globales = await ejecutarBusquedaDrive(drive, query, undefined);
      return { resultados: globales, fueraDelFiltro: globales.length > 0 };
    }
    return { resultados: filtrados, fueraDelFiltro: false };
  } catch (err) {
    console.error("Error buscando en Drive:", err.message);
    try {
      const globales = await ejecutarBusquedaDrive(drive, query, undefined);
      return { resultados: globales, fueraDelFiltro: Boolean(folderId) && globales.length > 0 };
    } catch (err2) {
      console.error("Error en búsqueda de respaldo:", err2.message);
      return { resultados: [], fueraDelFiltro: false };
    }
  }
}

/* ---------- Drive: lectura del contenido ---------- */

// Lee el texto de los primeros Google Docs / Sheets encontrados.
async function leerContenido(drive, resultados) {
  if (!drive) return [];
  const leibles = resultados
    .filter((r) => r.source === "drive" && (r.mimeType === MIME_DOC || r.mimeType === MIME_SHEET))
    .slice(0, MAX_DOCS_A_LEER);

  const lecturas = await Promise.all(
    leibles.map(async (f) => {
      try {
        const res = await drive.files.export(
          { fileId: f.id, mimeType: f.mimeType === MIME_SHEET ? "text/csv" : "text/plain" },
          { responseType: "text" }
        );
        return { title: f.title, texto: String(res.data).slice(0, MAX_CHARS_POR_DOC) };
      } catch (err) {
        console.error(`No se pudo leer "${f.title}":`, err.message);
        return null;
      }
    })
  );
  return lecturas.filter(Boolean);
}

/* ---------- Gemini: reintentos ---------- */

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Errores temporales de Gemini (alta demanda, límite, caída momentánea)
function esErrorTemporal(err) {
  const msg = String(err?.message || "");
  return (
    err?.status === 503 ||
    err?.status === 429 ||
    err?.status === 500 ||
    /high demand|overloaded|unavailable|try again|quota|rate/i.test(msg)
  );
}

// Reintenta con espera creciente. Si define GEMINI_FALLBACK_MODEL en Vercel,
// los últimos intentos se hacen con ese modelo alternativo.
async function generarConReintentos(genAI, prompt) {
  const principal = "gemini-3.6-flash";
  const alterno = process.env.GEMINI_FALLBACK_MODEL;
  const intentos = [
    { modelo: principal, espera: 0 },
    { modelo: principal, espera: 1500 },
    { modelo: alterno || principal, espera: 3000 },
  ];

  let ultimoError;
  for (const { modelo, espera } of intentos) {
    if (espera) await esperar(espera);
    try {
      const model = genAI.getGenerativeModel({ model: modelo });
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (err) {
      ultimoError = err;
      console.error(`Gemini (${modelo}) falló:`, err.message);
      if (!esErrorTemporal(err)) break;
    }
  }
  throw ultimoError;
}

// Si Gemini no responde, igual se devuelven los links encontrados.
function respuestaDeRespaldo(resultados) {
  if (resultados.length === 0) {
    return {
      intro: "Hola GTcito, no encontré documentos relacionados con tu búsqueda.",
      respuesta: "",
      items: [],
      outro: "Prueba con otra palabra o dime en qué más te ayudo.",
    };
  }
  return {
    intro: "Hola GTcito, encontré esta información aquí:",
    respuesta: "",
    items: resultados.slice(0, 5).map((r) => ({ title: r.title, url: r.url })),
    outro: "La IA está con mucha demanda y no pude leer los documentos, pero aquí están los links. Si quieres, intenta de nuevo en un momento.",
  };
}

/* ---------- Gemini ---------- */

async function interpretarConGemini(apiKey, pregunta, resultados, contenidos, fueraDelFiltro) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const listado = resultados
    .map((r, i) => `${i + 1}. [${r.source.toUpperCase()}] "${r.title}" -> ${r.url}`)
    .join("\n");

  const bloqueContenido = contenidos.length
    ? contenidos.map((c) => `--- Documento: "${c.title}" ---\n${c.texto}`).join("\n\n")
    : "(no se pudo leer el contenido de ningún documento)";

  const notaFiltro = fueraDelFiltro
    ? `NOTA: no había nada en el filtro elegido; estos resultados vienen de todo el Drive. Dilo brevemente en "intro".`
    : "";

  const prompt = `
Eres el buscador interno de "Global Talks" (GT), grupo extraacadémico de la UPC.
Pregunta del integrante: "${pregunta}"

Resultados encontrados en Google Drive:
${listado || "(ninguno)"}

Contenido leído de los documentos:
${bloqueContenido}

${notaFiltro}

Responde SOLO con un objeto JSON válido (sin texto extra, sin bloques de código):
{
  "intro": "frase corta que empiece exactamente con 'Hola GTcito, encontré esta información aquí:' (si no hay nada relevante, una frase breve diciéndolo)",
  "respuesta": "texto plano, vacío si no aplica",
  "items": [ { "title": "título tal cual está en la lista", "url": "link exacto de la lista" } ],
  "outro": "frase corta ofreciendo ayuda con cualquier otra cosa"
}

Reglas:
- "respuesta": solo si la pregunta pide un dato concreto (quién, cuánto, cuándo, pasos, responsable) que se pueda contestar con el contenido leído. Máximo 3 frases, basadas ÚNICAMENTE en ese contenido. Si la persona solo busca un documento, déjala como "".
- No resumas los documentos. No inventes datos, documentos ni links.
- Todo viene de Google Drive; no menciones Notion.
- "items": solo documentos realmente relevantes, máximo 5.
- Texto plano: sin asteriscos, sin negritas, sin viñetas, sin markdown.
`.trim();

  const raw = await generarConReintentos(genAI, prompt);
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { intro: raw, respuesta: "", items: [], outro: "¿Te puedo ayudar con algo más?" };
  }

  return {
    intro: limpiarTexto(parsed.intro),
    respuesta: limpiarTexto(parsed.respuesta),
    items: Array.isArray(parsed.items) ? parsed.items : [],
    outro: limpiarTexto(parsed.outro),
  };
}

/* ---------- handler ---------- */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Usa POST" });

  const { query, folderId } = req.body || {};
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Falta 'query' en el body" });
  }

  try {
    let drive = null;
    try {
      drive = crearDrive(process.env.GDRIVE_SA_KEY);
    } catch (err) {
      console.error("GDRIVE_SA_KEY inválida:", err.message);
    }

    const driveResultado = await searchDrive(drive, query, folderId);
    const resultados = driveResultado.resultados;
    const contenidos = await leerContenido(drive, driveResultado.resultados);

    let respuesta;
    try {
      respuesta = await interpretarConGemini(
        process.env.GEMINI_API_KEY,
        query,
        resultados,
        contenidos,
        driveResultado.fueraDelFiltro
      );
    } catch (err) {
      console.error("Gemini no respondió, usando respaldo:", err.message);
      respuesta = respuestaDeRespaldo(resultados);
    }

    return res.status(200).json({ respuesta });
  } catch (err) {
    console.error("Error general:", err);
    return res.status(500).json({ error: "Error interno", detail: err.message });
  }
}