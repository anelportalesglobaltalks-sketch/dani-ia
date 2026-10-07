import { google } from "googleapis";
import mammoth from "mammoth";

const TTL_MS = 5 * 60 * 1000; // los archivos se vuelven a leer cada 5 min
const MAX_FILES = 40;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const BUDGET = 350_000; // tope aproximado de contenido enviado a la IA

let cache = { at: 0, result: null };

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Falta la variable GOOGLE_SERVICE_ACCOUNT_JSON");
  const text = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(text),
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

  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) throw new Error("Falta la variable DRIVE_FOLDER_ID");

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
