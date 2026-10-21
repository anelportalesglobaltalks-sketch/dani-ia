// lib/drive.js
import { google } from 'googleapis';

/**
 * Formatea correctamente la clave privada de Google en Vercel
 */
const getPrivateKey = () => {
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!key) return undefined;
  return key.replace(/\\n/g, '\n');
};

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: getPrivateKey(),
  },
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

const drive = google.drive({ version: 'v3', auth });

/**
 * Recorre recursivamente las carpetas y subcarpetas en Google Drive
 */
export async function getAllDocumentsFromFolder(folderId) {
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType)',
      pageSize: 100,
    });

    const items = res.data.files || [];
    let allFiles = [];

    // Procesar subcarpetas y archivos en paralelo
    const tasks = items.map(async (item) => {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        // Recorrer subcarpeta de manera recursiva
        const subFiles = await getAllDocumentsFromFolder(item.id);
        return subFiles;
      } else {
        return [item];
      }
    });

    const results = await Promise.all(tasks);
    results.forEach((fileList) => {
      allFiles = allFiles.concat(fileList);
    });

    return allFiles;
  } catch (error) {
    console.error('Error al listar archivos en Google Drive:', error);
    return [];
  }
}