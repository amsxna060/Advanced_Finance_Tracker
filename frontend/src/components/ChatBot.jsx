import { useState, useRef, useEffect, useCallback } from "react";
import api from "../lib/api";

/* ── Markdown-lite renderer ───────────────────────────────────────── */

function renderMarkdown(text) {
  if (!text) return "";

  // Split into blocks for table detection
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    // Detect markdown table (line with |)
    if (lines[i].includes("|") && i + 1 < lines.length && /^\|?[\s-:|]+\|/.test(lines[i + 1])) {
      const tableLines = [];
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "table", lines: tableLines });
    } else {
      blocks.push({ type: "text", content: lines[i] });
      i++;
    }
  }

  return blocks.map((block, bi) => {
    if (block.type === "table") {
      return renderTable(block.lines, bi);
    }
    return renderLine(block.content, bi);
  });
}

function renderTable(lines, key) {
  // Parse header
  const parseRow = (line) =>
    line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);

  const headers = parseRow(lines[0]);
  // Skip separator line (index 1)
  const rows = lines.slice(2).map(parseRow);

  return (
    <div key={key} className="my-2 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-100 text-slate-700">
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold whitespace-nowrap">
                {formatInlineMarkdown(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 ? "bg-slate-50" : "bg-white"}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5 whitespace-nowrap">
                  {formatInlineMarkdown(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatInlineMarkdown(text) {
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  // Inline code
  text = text.replace(/`(.+?)`/g, '<code class="bg-slate-100 px-1 rounded text-xs">$1</code>');
  return <span dangerouslySetInnerHTML={{ __html: text }} />;
}

function renderLine(line, key) {
  if (!line.trim()) return <div key={key} className="h-2" />;

  // Headers
  if (line.startsWith("### "))
    return <h4 key={key} className="font-bold text-sm mt-2 mb-1 text-slate-800">{formatInlineMarkdown(line.slice(4))}</h4>;
  if (line.startsWith("## "))
    return <h3 key={key} className="font-bold text-sm mt-3 mb-1 text-slate-900">{formatInlineMarkdown(line.slice(3))}</h3>;
  if (line.startsWith("# "))
    return <h2 key={key} className="font-extrabold text-base mt-3 mb-1">{formatInlineMarkdown(line.slice(2))}</h2>;

  // Bullet points
  if (/^[-*•]\s/.test(line))
    return <li key={key} className="ml-4 list-disc text-sm leading-relaxed">{formatInlineMarkdown(line.slice(2))}</li>;
  if (/^\d+\.\s/.test(line))
    return <li key={key} className="ml-4 list-decimal text-sm leading-relaxed">{formatInlineMarkdown(line.replace(/^\d+\.\s/, ""))}</li>;

  return <p key={key} className="text-sm leading-relaxed">{formatInlineMarkdown(line)}</p>;
}

/* ── Quick suggestion chips ───────────────────────────────────────── */

const QUICK_PROMPTS = [
  "What's my financial overview?",
  "Show my account balances",
  "Any overdue payments?",
  "Check for data issues",
  "Show recent transactions",
];

/* ── ChatBot Component ────────────────────────────────────────────── */

export default function ChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  const sendMessage = useCallback(
    async (text) => {
      if (!text.trim() || loading) return;

      const userMsg = { role: "user", content: text.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setLoading(true);
      setError(null);

      // Build history (last 10 exchanges)
      const history = [...messages, userMsg]
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        const res = await api.post("/api/chat", {
          message: text.trim(),
          history: history.slice(0, -1), // exclude current message from history
        });

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.data.reply,
            toolCalls: res.data.tool_calls,
          },
        ]);
      } catch (err) {
        const detail = err.response?.data?.detail || "Something went wrong. Please try again.";
        setError(detail);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `⚠️ ${detail}`, isError: true },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages],
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <>
      {/* ── Floating Action Button ──────────────────────────────── */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-5 right-5 z-[9999] w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-110 ${
          isOpen
            ? "bg-slate-700 hover:bg-slate-800 rotate-0"
            : "bg-gradient-to-br from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
        }`}
        title={isOpen ? "Close chat" : "Ask AI Assistant"}
      >
        {isOpen ? (
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
            />
          </svg>
        )}
      </button>

      {/* ── Chat Panel ──────────────────────────────────────────── */}
      <div
        className={`fixed bottom-24 right-5 z-[9998] w-[380px] max-w-[calc(100vw-40px)] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col transition-all duration-300 origin-bottom-right ${
          isOpen ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"
        }`}
        style={{ height: "min(580px, calc(100vh - 140px))" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-t-2xl">
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold text-sm">FinTracker AI</h3>
            <p className="text-blue-100 text-xs">Your financial assistant</p>
          </div>
          {messages.length > 0 && (
            <button
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
              className="text-white/70 hover:text-white text-xs px-2 py-1 rounded hover:bg-white/10 transition-colors"
              title="Clear chat"
            >
              Clear
            </button>
          )}
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                  />
                </svg>
              </div>
              <h4 className="text-slate-800 font-semibold text-sm mb-1">Hi! I'm your financial assistant</h4>
              <p className="text-slate-500 text-xs mb-4">Ask me about your accounts, loans, expenses, or anything financial.</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="text-xs px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors border border-blue-100"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white rounded-br-md"
                        : msg.isError
                          ? "bg-red-50 text-red-800 border border-red-200 rounded-bl-md"
                          : "bg-slate-100 text-slate-800 rounded-bl-md"
                    }`}
                  >
                    {msg.role === "user" ? (
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                    ) : (
                      <div className="chat-reply">{renderMarkdown(msg.content)}</div>
                    )}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mt-1.5 pt-1.5 border-t border-slate-200/50">
                        <p className="text-[10px] text-slate-400">
                          Analysed: {msg.toolCalls.map((t) => t.replace("get_", "").replace(/_/g, " ")).join(", ")}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input area */}
        <form onSubmit={handleSubmit} className="border-t border-slate-100 px-3 py-2.5 flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your finances..."
            rows={1}
            className="flex-1 resize-none rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent placeholder:text-slate-400 max-h-24 overflow-y-auto"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </form>
      </div>
    </>
  );
}
