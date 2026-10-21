// lib/drive.js
import { google } from 'googleapis';

const getPrivateKey = () => {
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!key) return undefined;
  // Limpia comillas dobles externas y formatea los saltos de línea \n
  return key.replace(/^"|"$/g, '').replace(/\\n/g, '\n');
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
 * Obtiene recursivamente todos los documentos alojados dentro de las subcarpetas GT
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

    const tasks = items.map(async (item) => {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        // Entrar a subcarpetas de forma recursiva
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
    console.error('Error al explorar carpetas en Drive:', error);
    return [];
  }
}