// api/chat.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getAllDocumentsFromFolder } from '../lib/drive.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function formatPlainResponse(text) {
  if (!text) return '';
  return text
    .replace(/^#+\s+/gm, '')
    .replace(/\*{1,3}/g, '')
    .replace(/_{1,2}/g, '')
    .replace(/^\s*[-+]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Pregunta no válida.' });
    }

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      return res.status(500).json({ error: 'Falta GOOGLE_DRIVE_FOLDER_ID' });
    }

    // 1. Obtener archivos
    let documents = [];
    try {
      documents = await getAllDocumentsFromFolder(folderId);
    } catch (driveErr) {
      console.error('Error al leer carpetas de Google Drive:', driveErr);
    }

    const docNames = documents.map((doc) => `- ${doc.name}`).join('\n');
    const context = docNames.length > 0 ? docNames : 'No se encontraron documentos.';

    // 2. Prompt indicando respuestas en texto plano
    const prompt = `
Eres un asistente virtual de lectura de documentos para Global Talks.
Responde de manera clara y profesional en texto plano sin usar formato Markdown como asteriscos (***), guiones bajos (_) o numerales (##).

Estructura de documentos accesibles:
${context}

Pregunta del usuario:
${question}
`;

    // 3. Consulta con modelo Gemini compatible
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    const cleanAnswer = formatPlainResponse(responseText);

    return res.status(200).json({ answer: cleanAnswer });

  } catch (error) {
    console.error('Error en API chat:', error);
    return res.status(500).json({ 
      error: 'Error al procesar la solicitud.',
      details: error.message 
    });
  }
}