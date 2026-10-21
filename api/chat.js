// api/chat.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getAllDocumentsFromFolder } from '../lib/drive.js';

// Inicialización del cliente con la SDK oficial de Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Elimina sintaxis de Markdown (***, **, ##, _, etc.)
 */
function formatPlainResponse(text) {
  if (!text) return '';
  return text
    // Eliminar títulos / encabezados Markdown (##, ###, etc.)
    .replace(/^#+\s+/gm, '')
    // Eliminar asteriscos de negrita, cursiva o listas (***, **, *)
    .replace(/\*{1,3}/g, '')
    // Eliminar guiones bajos de formato (__, _)
    .replace(/_{1,2}/g, '')
    // Convertir listas con guion a viñetas limpias
    .replace(/^\s*[-+]\s+/gm, '• ')
    // Limpiar saltos de línea múltiples
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Se requiere una pregunta válida.' });
    }

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      return res.status(500).json({ error: 'Falta la variable GOOGLE_DRIVE_FOLDER_ID en el entorno.' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Falta la variable GEMINI_API_KEY en el entorno.' });
    }

    // 1. Obtener la lista de documentos de las subcarpetas GT (GTPI, PYC, Diseño, Redes, Redacción)
    let documents = [];
    try {
      documents = await getAllDocumentsFromFolder(folderId);
    } catch (driveErr) {
      console.error('Error al leer carpetas de Google Drive:', driveErr);
    }

    // 2. Formatear el contexto de los documentos
    const docNames = documents.map((doc) => `- ${doc.name}`).join('\n');
    const context = docNames.length > 0 
      ? docNames 
      : 'No se encontraron documentos en las subcarpetas de Google Drive.';

    // 3. Crear Prompt indicando respuesta sin sintaxis Markdown
    const prompt = `
Eres un asistente virtual de lectura de documentos para Global Talks.
Responde de manera clara, amable y profesional en texto plano sin usar sintaxis de formato Markdown como asteriscos (***), guiones bajos (_) o numerales (##).

Estructura de documentos accesibles:
${context}

Pregunta del usuario:
${question}
`;

    // 4. Invocar el modelo Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // 5. Aplicar formateador sin Markdown
    const cleanAnswer = formatPlainResponse(responseText);

    return res.status(200).json({ answer: cleanAnswer });

  } catch (error) {
    console.error('Error en API chat:', error);
    return res.status(500).json({ 
      error: 'Error interno del servidor', 
      details: error.message 
    });
  }
}