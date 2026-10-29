import { getFolderDocs } from "../lib/drive.js";

export default async function handler(req, res) {
  try {
    const force = req.query?.refresh === "1";
    const { docs, skipped } = await getFolderDocs(force);
    res.status(200).json({
      files: docs.map((d) => ({ id: d.id, name: d.name, kind: d.kind })),
      skipped,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "No se pudo leer la carpeta" });
  }
}
