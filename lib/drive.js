// lib/drive.js
import { google } from 'googleapis';

function parsePrivateKey(rawKey) {
  if (!rawKey) return '';
  
  let key = rawKey.trim();
  
  // 1. Quitar comillas simples o dobles externas si fueron pegadas en Vercel
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  
  // 2. Reemplazar los saltos de línea escapados '\\n' por '\n' reales
  key = key.replace(/\\n/g, '\n');

  return key;
}

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: parsePrivateKey(process.env.GOOGLE_PRIVATE_KEY),
  },
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

const drive = google.drive({ version: 'v3', auth });

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