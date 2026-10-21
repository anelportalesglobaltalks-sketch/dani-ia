// src/App.jsx
import React, { useState, useEffect } from 'react';
import './styles.css';

export default function App() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState([]);

  // Cargar lista de archivos al iniciar la app
  useEffect(() => {
    fetchFiles();
  }, []);

  const fetchFiles = async () => {
    try {
      const res = await fetch('/api/files');
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch (err) {
      console.error('Error cargando archivos:', err);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        alert('Archivo subido correctamente');
        fetchFiles(); // Recargar la lista de documentos
      } else {
        alert('Error al subir el archivo');
      }
    } catch (err) {
      console.error(err);
      alert('Error al procesar la subida');
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    const userText = query;
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setQuery('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userText }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'bot', text: data.answer }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'bot', text: 'Error al procesar la consulta.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-layout">
      {/* Barra Lateral Izquierda */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Documentos GT</h2>
        </div>

        {/* Botón de subir archivo */}
        <div className="upload-section">
          <label className="upload-btn">
            {uploading ? 'Subiendo...' : '+ Subir Archivo'}
            <input 
              type="file" 
              onChange={handleFileUpload} 
              disabled={uploading} 
              style={{ display: 'none' }} 
            />
          </label>
        </div>

        {/* Lista de Carpetas y Documentos */}
        <div className="files-tree">
          <div className="folder-title">📁 GT</div>
          <ul className="file-list">
            {files.length > 0 ? (
              files.map((file) => (
                <li key={file.id} className="file-item">
                  📄 {file.name}
                </li>
              ))
            ) : (
              <li className="no-files">Cargando carpetas...</li>
            )}
          </ul>
        </div>
      </aside>

      {/* Contenido Principal (Chat) */}
      <main className="main-content">
        <header className="app-header">
          <h1>Global Talks - Asistente de Documentos</h1>
        </header>

        <div className="chat-history">
          {messages.map((m, idx) => (
            <div key={idx} className={`message ${m.role}`}>
              {m.text}
            </div>
          ))}
          {loading && <div className="message bot">Procesando y consultando documentos...</div>}
        </div>

        <footer className="chat-input-container">
          <form onSubmit={handleSend} className="chat-input-form">
            <input
              type="text"
              placeholder="Escribe tu consulta sobre los documentos GT..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" disabled={loading}>
              Enviar
            </button>
          </form>
        </footer>
      </main>
    </div>
  );
}