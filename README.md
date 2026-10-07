# Pregúntale a tus archivos

Página en React que lee los archivos de una carpeta de Google Drive (y el archivo que suba la persona) y responde preguntas basándose en ellos con Gemini. Se despliega en Vercel.

Formatos de la carpeta: Google Docs, Sheets, Slides, PDF, DOCX, TXT, MD, CSV, JSON.

## 1. Cuenta de servicio de Google (una sola vez)

1. En [Google Cloud Console](https://console.cloud.google.com) crea un proyecto.
2. Activa **Google Drive API** (APIs y servicios → Biblioteca).
3. Ve a IAM y administración → **Cuentas de servicio** → Crear cuenta de servicio.
4. Entra a la cuenta → pestaña **Claves** → Agregar clave → JSON. Se descarga un archivo.
5. Copia el correo de la cuenta de servicio (termina en `iam.gserviceaccount.com`).
6. En Drive, **comparte tu carpeta con ese correo** como "Lector".
7. El ID de la carpeta es lo que va después de `/folders/` en su URL.

## 2. Clave de Gemini

Entra a [aistudio.google.com](https://aistudio.google.com) → **Get API key** → **Create API key**.

## 3. Subir a GitHub y desplegar en Vercel

1. Sube esta carpeta a un repositorio de GitHub.
2. En [vercel.com](https://vercel.com) → Add New → Project → importa el repositorio.
3. En **Environment Variables** agrega:
   - `GEMINI_API_KEY`
   - `DRIVE_FOLDER_ID`
   - `GOOGLE_SERVICE_ACCOUNT_JSON` → pega el contenido completo del JSON descargado
   - `GEMINI_MODEL` (opcional, por defecto `gemini-2.5-flash`)
4. Deploy.

## Probar en tu computadora

```bash
npm install
cp .env.example .env.local   # llena los valores
npx vercel dev               # levanta la página y la carpeta /api juntas
```

(`npm run dev:front` solo levanta el diseño; sin `vercel dev` las llamadas a `/api` no funcionan.)

## Límites a tener en cuenta

- Lee hasta 40 archivos de 10 MB cada uno y un tope total de contenido; lo que no cabe aparece como "sin leer" en la columna izquierda.
- El archivo que sube la persona puede pesar hasta 3 MB (límite de las peticiones en Vercel).
- Los archivos de Drive se guardan en memoria 5 minutos; el botón "Actualizar" fuerza una nueva lectura.
- Para carpetas muy grandes conviene pasar a búsqueda por fragmentos (RAG) con una base vectorial.
- Vercel gratis corta las funciones a los 60 s: con muchos PDFs la primera pregunta puede tardar.

- La capa gratuita de Gemini tiene límites por minuto y por día; si los superas, la página te avisa y basta con esperar un poco.
