// src/App.jsx
import React, { useState } from 'react';
import './styles.css';

export default function App() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

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
    <div className="app-container">
      <header className="app-header">
        <h1>Global Talks - Asistente de Documentos</h1>
      </header>

      <main className="chat-history">
        {messages.map((m, idx) => (
          <div key={idx} className={`message ${m.role}`}>
            {m.text}
          </div>
        ))}
        {loading && <div className="message bot">Leyendo documentos...</div>}
      </main>

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
    </div>
  );
}