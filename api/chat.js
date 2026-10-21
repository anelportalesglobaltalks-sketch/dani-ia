import mammoth from "mammoth";
import { getFolderDocs } from "../lib/drive.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM = `Eres un asistente que responde preguntas usando como fuente principal los archivos que se te entregan (los de una carpeta de Google Drive y, si existe, el archivo que subió la persona).

Reglas:
- Basa tus respuestas en el contenido de los archivos y nombra de qué archivo sale cada dato.
- Si la respuesta no está en los archivos, dilo claramente y, si puedes ayudar con conocimiento general, ofrécelo marcándolo como "fuera de los archivos".
- Si los archivos se contradicen, muestra ambas versiones y de qué archivo viene cada una.
- Responde en el idioma de la pregunta, de forma clara y sin relleno.`;

// Convierte un archivo en "partes" que entiende Gemini
function fileParts(d) {
  if (d.kind === "pdf") {
    return [
      { text: `Archivo PDF: ${d.name}` },
      { inlineData: { mimeType: "application/pdf", data: d.data } },
    ];
  }
  return [{ text: `<archivo nombre="${d.name}">\n${d.text}\n</archivo>` }];
}

async function uploadToParts(upload) {
  if (!upload) return [];
  const name = `${upload.name} (subido por la persona)`;
  if (upload.kind === "docx") {
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(upload.data, "base64"),
    });
    return fileParts({ name, kind: "text", text: value });
  }
  if (upload.kind === "pdf") return fileParts({ name, kind: "pdf", data: upload.data });
  return fileParts({ name, kind: "text", text: upload.text || "" });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Falta la variable GEMINI_API_KEY");

    const { messages, upload } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Falta la pregunta" });
    }

    const { docs } = await getFolderDocs();
    const contextParts = docs.flatMap(fileParts);
    const uploadParts = await uploadToParts(upload);

    const contents = messages.map((m, i) => {
      const parts = [{ text: String(m.content) }];
      if (i === 0 && m.role === "user") {
        return { role: "user", parts: [...contextParts, ...uploadParts, ...parts] };
      }
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents,
        generationConfig: { maxOutputTokens: 2000 },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(
          "Llegaste al límite gratuito de Gemini por ahora. Espera un minuto e inténtalo de nuevo."
        );
      }
      throw new Error(data?.error?.message || "Error al consultar Gemini");
    }

    const answer = (data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("\n")
      .trim();

    if (!answer) {
      throw new Error("Gemini no devolvió respuesta. Reformula la pregunta e inténtalo otra vez.");
    }

    res.status(200).json({ answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al responder" });
  }
}