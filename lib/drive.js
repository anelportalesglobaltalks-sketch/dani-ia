// lib/drive.js
import { google } from 'googleapis';

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

const drive = google.drive({ version: 'v3', auth });

/**
 * Obtiene todos los archivos contenidos recursivamente en subcarpetas
 */
export async function getAllDocumentsFromFolder(folderId) {
  let allFiles = [];

  // Obtener elementos dentro de la carpeta actual
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
  });

  const items = res.data.files || [];

  for (const item of items) {
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      // Si es una subcarpeta (ej. GT, Actividades, GTPI, etc.), recorrer recursivamente
      const subFolderFiles = await getAllDocumentsFromFolder(item.id);
      allFiles = allFiles.concat(subFolderFiles);
    } else {
      // Si es un documento, guardarlo
      allFiles.push(item);
    }
  }

  return allFiles;
}