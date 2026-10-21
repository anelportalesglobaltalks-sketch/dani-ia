// api/files.js
import { getAllDocumentsFromFolder } from '../lib/drive.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      return res.status(500).json({ error: 'Falta GOOGLE_DRIVE_FOLDER_ID' });
    }

    const files = await getAllDocumentsFromFolder(folderId);
    return res.status(200).json({ files });
  } catch (error) {
    console.error('Error en /api/files:', error);
    return res.status(500).json({ files: [], error: error.message });
  }
}