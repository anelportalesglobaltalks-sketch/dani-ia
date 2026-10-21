// api/chat.js
import { GoogleGenerativeAI } from '@google-genai/google-genai';
import { getAllDocumentsFromFolder } from '../lib/drive.js';

// Inicializar el SDK de Gemini con la API Key configurada en Vercel
const ai = new GoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/**
 * Función para limpiar la respuesta del modelo, eliminando
 * sintaxis de Markdown como '***', '##', asteriscos y negritas.
 */
function formatPlainResponse(text) {
  if (!text) return '';
  return text
    // Eliminar títulos / encabezados Markdown (##, ###, etc.)
    .replace(/^#+\s+/gm, '')
    // Eliminar negritas, cursivas o combinaciones con asteriscos (***, **, *)
    .replace(/\*{1,3}/g, '')
    // Eliminar guiones bajos de formato (__, _)
    .replace(/_{1,2}/g, '')
    // Reemplazar listas con guion/mas por viñetas limpias
    .replace(/^\s*[-+]\s+/gm, '• ')
    // Limpiar saltos de línea excesivos
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
      return res.status(500).json({ error: 'Falta la variable GOOGLE_DRIVE_FOLDER_ID.' });
    }

    // 1. Obtener recursivamente todos los documentos contenidos dentro de las subcarpetas GT
    const documents = await getAllDocumentsFromFolder(folderId);

    // 2. Preparar el contexto reuniendo la lista e información relevante de los archivos hallados
    const docNames = documents.map((doc) => `- ${doc.name}`).join('\n');
    
    const context = `
Archivos y documentos disponibles en el sistema:
${docNames.length > 0 ? docNames : 'No se encontraron documentos en las subcarpetas.'}
`;

    // 3. Crear el prompt e instruir a la IA a responder sin usar Markdown agresivo
    const prompt = `
Eres un asistente virtual de lectura de documentos para Global Talks.
Responde de manera clara, amable, ejecutiva y profesional en texto plano sin usar sintaxis Markdown como asteriscos, guiones bajos o numerales.

Contexto de documentos disponibles:
${context}

Pregunta del usuario:
${question}
`;

    // 4. Consultar al modelo de Gemini
    const model = 'gemini-1.5-flash';
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
    });

    const rawAnswer = response.text || 'No se pudo generar una respuesta.';

    // 5. Aplicar la limpieza para asegurar que la respuesta no lleve *** ni ##
    const cleanAnswer = formatPlainResponse(rawAnswer);

    return res.status(200).json({ answer: cleanAnswer });
  } catch (error) {
    console.error('Error en api/chat.js:', error);
    return res.status(500).json({
      error: 'Ocurrió un error al procesar la solicitud.',
      details: error.message,
    });
  }
}