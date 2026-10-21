import React, { useState } from 'react';
import './styles.css';

export default function Chat() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleAsk = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    const userMessage = { role: 'user', text: query };
    setMessages((prev) => [...prev, userMessage]);
    setQuery('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query }),
      });
      const data = await res.json();
      
      const botMessage = { role: 'bot', text: data.answer };
      setMessages((prev) => [...prev, botMessage]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-history">
        {messages.map((m, idx) => (
          <div key={idx} className={`message ${m.role}`}>
            <strong>{m.role === 'user' ? 'Tú' : 'IA'}:</strong> {m.text}
          </div>
        ))}
        {loading && <div className="message bot">Procesando y leyendo documentos...</div>}
      </div>
      <form onSubmit={handleAsk} className="chat-input-form">
        <input 
          type="text" 
          value={query} 
          placeholder="Escribe tu pregunta sobre los documentos..." 
          onChange={(e) => setQuery(e.target.value)} 
        />
        <button type="submit">Enviar</button>
      </form>
    </div>
  );
}