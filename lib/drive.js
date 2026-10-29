import { google } from "googleapis";
import mammoth from "mammoth";

const TTL_MS = 5 * 60 * 1000; // los archivos se vuelven a leer cada 5 min
const MAX_FILES = 40;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const BUDGET = 350_000; // tope aproximado de contenido enviado a la IA

let cache = { at: 0, result: null };

function stripQuotes(v) {
  v = (v || "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

// Reconstruye una clave privada PEM aunque haya llegado dañada
// (saltos de línea como "\\n" literales, espacios, comillas, coma final, base64...)
export function normalizePrivateKey(input) {
  let k = String(input || "").trim();

  // Si pegaron todo el JSON en esta variable, saca el campo private_key
  if (k.startsWith("{")) {
    try {
      k = JSON.parse(k).private_key || k;
    } catch {}
  }

  // Si viene codificada en base64 (sin cabecera), decodifícala
  if (!k.includes("BEGIN") && !k.includes("\\n")) {
    const dec = Buffer.from(k, "base64").toString("utf8");
    if (dec.includes("BEGIN")) k = dec;
  }

  const m = k.match(
    /-----BEGIN ([A-Z ]*?)PRIVATE KEY-----([\s\S]*?)-----END \1PRIVATE KEY-----/
  );
  if (!m) {
    throw new Error(
      "GOOGLE_PRIVATE_KEY no contiene un bloque -----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY-----. Copia de nuevo el campo private_key del JSON."
    );
  }
  const type = m[1]; // "" para PKCS8, "RSA " para PKCS1
  const body = m[2]
    .replace(/\\r|\\n/g, "") // \n y \r literales
    .replace(/[^A-Za-z0-9+/=]/g, ""); // espacios, comillas, comas, saltos reales

  if (body.length < 200) {
    throw new Error(
      "GOOGLE_PRIVATE_KEY está cortada (muy corta). Vuelve a copiarla completa."
    );
  }
  const lines = body.match(/.{1,64}/g).join("\n");
  return `-----BEGIN ${type}PRIVATE KEY-----\n${lines}\n-----END ${type}PRIVATE KEY-----\n`;
}

function getCredentials() {
  // Opción A (la que tienes en Vercel): correo + clave privada por separado
  const email = stripQuotes(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const keyRaw = process.env.GOOGLE_PRIVATE_KEY;
  if (email && keyRaw && keyRaw.trim()) {
    return { client_email: email, private_key: normalizePrivateKey(keyRaw) };
  }

  // Opción B: el JSON completo de la cuenta de servicio (o en base64)
  let raw = stripQuotes(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!raw) {
    throw new Error(
      "Faltan credenciales de Google: define GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_PRIVATE_KEY (o GOOGLE_SERVICE_ACCOUNT_JSON)"
    );
  }
  if (!raw.startsWith("{")) {
    const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
    if (decoded.startsWith("{")) raw = decoded;
    else {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON no contiene el archivo JSON de la cuenta de servicio."
      );
    }
  }
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON está incompleto o cortado.");
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error(
      "El JSON no parece ser de una cuenta de servicio (faltan client_email o private_key)."
    );
  }
  return creds;
}

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

async function download(drive, id) {
  const res = await drive.files.get(
    { fileId: id, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data);
}

async function exportAs(drive, id, mimeType) {
  const res = await drive.files.export(
    { fileId: id, mimeType },
    { responseType: "text" }
  );
  return String(res.data);
}

async function readFile(drive, f) {
  const m = f.mimeType;
  if (m === "application/vnd.google-apps.document")
    return { kind: "text", text: await exportAs(drive, f.id, "text/plain") };
  if (m === "application/vnd.google-apps.presentation")
    return { kind: "text", text: await exportAs(drive, f.id, "text/plain") };
  if (m === "application/vnd.google-apps.spreadsheet")
    return { kind: "text", text: await exportAs(drive, f.id, "text/csv") };
  if (m === "application/pdf") {
    const buf = await download(drive, f.id);
    return { kind: "pdf", data: buf.toString("base64"), size: buf.length };
  }
  if (
    m ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const buf = await download(drive, f.id);
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { kind: "text", text: value };
  }
  if (m.startsWith("text/") || m === "application/json") {
    const buf = await download(drive, f.id);
    return { kind: "text", text: buf.toString("utf8") };
  }
  return null; // formato no soportado
}

export async function getFolderDocs(force = false) {
  if (!force && cache.result && Date.now() - cache.at < TTL_MS) {
    return cache.result;
  }

  const folderId = stripQuotes(
    process.env.GOOGLE_DRIVE_FOLDER_ID || process.env.DRIVE_FOLDER_ID
  );
  if (!folderId) throw new Error("Falta la variable GOOGLE_DRIVE_FOLDER_ID");

  const drive = google.drive({ version: "v3", auth: getAuth() });
  const { data } = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id, name, mimeType, size)",
    pageSize: 100,
    orderBy: "name",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const docs = [];
  const skipped = [];
  let used = 0;

  for (const f of (data.files || []).slice(0, MAX_FILES)) {
    if (Number(f.size || 0) > MAX_FILE_BYTES) {
      skipped.push({ name: f.name, reason: "Pesa más de 10 MB" });
      continue;
    }
    try {
      const content = await readFile(drive, f);
      if (!content) {
        skipped.push({ name: f.name, reason: "Formato no soportado" });
        continue;
      }
      const cost =
        content.kind === "pdf" ? content.size * 0.5 : content.text.length;
      if (used + cost > BUDGET) {
        skipped.push({ name: f.name, reason: "No cabe en el límite de lectura" });
        continue;
      }
      used += cost;
      docs.push({ id: f.id, name: f.name, ...content });
    } catch (err) {
      skipped.push({ name: f.name, reason: "No se pudo leer" });
    }
  }

  cache = { at: Date.now(), result: { docs, skipped } };
  return cache.result;
}