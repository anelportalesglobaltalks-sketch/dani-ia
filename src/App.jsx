import { useEffect, useRef, useState } from "react";

const MAX_UPLOAD = 3 * 1024 * 1024; // límite práctico en Vercel (~4.5 MB de petición)
const SUGGESTIONS = [
  "¿Qué archivos tengo disponibles y de qué trata cada uno?",
  "Hazme un resumen de los puntos más importantes",
  "¿Qué fechas o plazos aparecen en los documentos?",
];

function readUpload(file) {
  return new Promise((resolve, reject) => {
    const name = file.name;
    const ext = name.split(".").pop().toLowerCase();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));

    if (file.size > MAX_UPLOAD) {
      return reject(new Error("El archivo pesa más de 3 MB. Sube uno más liviano."));
    }
    if (["txt", "md", "csv", "json"].includes(ext)) {
      reader.onload = () => resolve({ name, kind: "text", text: reader.result });
      reader.readAsText(file);
    } else if (["pdf", "docx"].includes(ext)) {
      reader.onload = () =>
        resolve({ name, kind: ext, data: String(reader.result).split(",")[1] });
      reader.readAsDataURL(file);
    } else {
      reject(new Error("Formato no admitido. Usa PDF, DOCX, TXT, MD, CSV o JSON."));
    }
  });
}

export default function App() {
  const [driveFiles, setDriveFiles] = useState([]);
  const [skipped, setSkipped] = useState([]);
  const [driveState, setDriveState] = useState("loading"); // loading | ready | error
  const [driveError, setDriveError] = useState("");

  const [upload, setUpload] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");

  const fileInput = useRef(null);
  const endRef = useRef(null);

  async function loadFiles(refresh = false) {
    setDriveState("loading");
    try {
      const res = await fetch(`/api/files${refresh ? "?refresh=1" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo leer la carpeta.");
      setDriveFiles(data.files);
      setSkipped(data.skipped || []);
      setDriveState("ready");
    } catch (err) {
      setDriveError(err.message);
      setDriveState("error");
    }
  }

  useEffect(() => {
    loadFiles();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function handleFile(file) {
    if (!file) return;
    setUploadError("");
    try {
      setUpload(await readUpload(file));
    } catch (err) {
      setUploadError(err.message);
    }
  }

  async function send(text) {
    const question = text.trim();
    if (!question || sending) return;

    const next = [...messages, { role: "user", content: question }];
    setMessages(next);
    setInput("");
    setChatError("");
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, upload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo obtener respuesta.");
      setMessages([...next, { role: "assistant", content: data.answer }]);
    } catch (err) {
      setChatError(err.message);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="app">
      <aside className="rail">
        <h1 className="brand">Pregúntale a tus archivos</h1>

        <section className="block">
          <div className="block-head">
            <h2>Carpeta de Drive</h2>
            <button
              className="link"
              onClick={() => loadFiles(true)}
              disabled={driveState === "loading"}
            >
              Actualizar
            </button>
          </div>

          {driveState === "loading" && <p className="muted">Leyendo la carpeta…</p>}
          {driveState === "error" && <p className="error">{driveError}</p>}
          {driveState === "ready" && driveFiles.length === 0 && (
            <p className="muted">
              La carpeta no tiene archivos legibles. Comparte la carpeta con la cuenta
              de servicio y agrega documentos.
            </p>
          )}
          {driveState === "ready" && driveFiles.length > 0 && (
            <ul className="files">
              {driveFiles.map((f) => (
                <li key={f.id} title={f.name}>
                  <span className={`dot ${f.kind}`} />
                  <span className="name">{f.name}</span>
                </li>
              ))}
            </ul>
          )}
          {skipped.length > 0 && (
            <details className="skipped">
              <summary>{skipped.length} sin leer</summary>
              <ul>
                {skipped.map((s) => (
                  <li key={s.name}>
                    {s.name}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="block">
          <h2>Tu archivo</h2>
          {upload ? (
            <div className="uploaded">
              <span className="name" title={upload.name}>
                {upload.name}
              </span>
              <button className="link" onClick={() => setUpload(null)}>
                Quitar
              </button>
            </div>
          ) : (
            <div
              className={`drop ${dragging ? "over" : ""}`}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFile(e.dataTransfer.files[0]);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && fileInput.current?.click()}
            >
              <strong>Sube un archivo</strong>
              <span>PDF, DOCX, TXT, MD, CSV o JSON · hasta 3 MB</span>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".pdf,.docx,.txt,.md,.csv,.json"
            onChange={(e) => {
              handleFile(e.target.files[0]);
              e.target.value = "";
            }}
          />
          {uploadError && <p className="error">{uploadError}</p>}
        </section>
      </aside>

      <main className="chat">
        <div className="thread">
          {messages.length === 0 && (
            <div className="empty">
              <h2>¿Qué quieres saber de tus documentos?</h2>
              <p>
                Respondo con lo que dicen los archivos de la carpeta y el que subas, y
                te digo de cuál sale cada dato.
              </p>
              <div className="chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.content}
            </div>
          ))}

          {sending && <div className="msg assistant pending">Leyendo los archivos…</div>}
          {chatError && <div className="msg error-msg">{chatError}</div>}
          <div ref={endRef} />
        </div>

        <div className="composer">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Escribe tu pregunta"
            rows={1}
          />
          <button onClick={() => send(input)} disabled={sending || !input.trim()}>
            Preguntar
          </button>
        </div>
      </main>
    </div>
  );
}
