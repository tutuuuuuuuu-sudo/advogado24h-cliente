import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { io, Socket } from "socket.io-client";
import { GoogleGenAI } from "@google/genai";
import {
  Shield, AlertCircle, MapPin, MessageSquare, History,
  User, ChevronRight, Star, Send, Mic, X, Clock,
  CheckCircle2, Phone, Video, ArrowLeft, Search,
  Gavel, Navigation, Wifi, WifiOff
} from "lucide-react";

const genAI = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || "" });
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

// ─── UserId persistente ───────────────────────────────────────────────────────
function getOrCreateUserId(): string {
  const key = "adv24_client_id";
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const id = `client-${crypto.randomUUID()}`;
  localStorage.setItem(key, id);
  return id;
}
const USER_ID = getOrCreateUserId();

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface Lawyer {
  id: string; name: string; specialty: string;
  rating: number; status: "available" | "busy" | "offline";
  lat?: number; lng?: number; price_per_minute: number; oab?: string;
  distance?: number;
}
interface Message {
  from: string; message: string; sender: string; timestamp: number;
}
interface Emergency {
  id: string; status: string; lawyer_id?: string; specialty: string;
}

const SPECIALTIES = [
  { label: "Criminal", icon: "⚖️", desc: "Prisão, delegacia, flagrante" },
  { label: "Trabalhista", icon: "💼", desc: "Demissão, assédio, acidente" },
  { label: "Trânsito", icon: "🚗", desc: "Acidente, bafômetro, infração" },
  { label: "Família", icon: "👨‍👩‍👧", desc: "Divórcio, guarda, pensão" },
  { label: "Civil", icon: "📄", desc: "Contrato, dívida, fraude" },
  { label: "Geral", icon: "🛡️", desc: "Outro tipo de emergência" },
];

export default function AppCliente() {
  const [view, setView] = useState<"home" | "specialty" | "emergency" | "chat" | "history" | "profile" | "map">("home");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [lawyers, setLawyers] = useState<Lawyer[]>([]);
  const [selectedSpecialty, setSelectedSpecialty] = useState("");
  const [activeEmergency, setActiveEmergency] = useState<Emergency | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isAILoading, setIsAILoading] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const [emergencyTimer, setEmergencyTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = useCallback((msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Geolocalização real
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(
      pos => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserLocation({ lat: -23.5505, lng: -46.6333 }),
      { enableHighAccuracy: true, maximumAge: 30000 }
    );
  }, []);

  // Socket
  useEffect(() => {
    const s = io(BACKEND_URL, { query: { userId: USER_ID, role: "client" } });
    setSocket(s);
    s.on("connect", () => setIsOnline(true));
    s.on("disconnect", () => setIsOnline(false));
    s.on("lawyers-update", (data: Lawyer[]) => {
      // Calcula distância se tiver localização
      if (userLocation) {
        const withDist = data.map(l => ({
          ...l,
          distance: l.lat && l.lng
            ? Math.round(haversine(userLocation.lat, userLocation.lng, l.lat, l.lng) * 10) / 10
            : undefined,
        }));
        setLawyers(withDist.sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999)));
      } else {
        setLawyers(data);
      }
    });
    s.on("emergency-accepted", ({ lawyerId }: any) => {
      setActiveEmergency(prev => prev ? { ...prev, lawyer_id: lawyerId, status: "accepted" } : null);
      setView("chat");
      showToast("Advogado conectado!", "ok");
      if (timerRef.current) clearInterval(timerRef.current);
    });
    s.on("emergency-completed", () => {
      setView("home");
      setActiveEmergency(null);
      setMessages([]);
      showToast("Atendimento finalizado.", "ok");
    });
    s.on("chat-message", (msg: Message) => setMessages(prev => [...prev, msg]));
    s.on("error", (e: any) => showToast(e.message, "err"));
    return () => { s.disconnect(); };
  }, [userLocation, showToast]);

  // Timer de espera durante emergência
  useEffect(() => {
    if (view === "emergency") {
      setEmergencyTimer(0);
      timerRef.current = setInterval(() => setEmergencyTimer(t => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [view]);

  const handleEmergency = async (specialty: string) => {
    if (!socket) return;
    setSelectedSpecialty(specialty);
    setView("emergency");
    setMessages([]);
    setIsAILoading(true);

    socket.emit("emergency-request", {
      specialty,
      location: userLocation ?? { lat: -23.5505, lng: -46.6333 },
      userId: USER_ID,
      mode: "online",
    });

    try {
      const result = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ parts: [{ text:
          `Você é uma IA jurídica de triagem do app "Advogado 24h". 
          O usuário acionou emergência de: ${specialty}.
          Em 3 perguntas curtas e diretas, colete as informações mais críticas para o advogado que vai atender.
          Seja empático, humano e profissional. Máximo 4 linhas no total.`
        }] }]
      });
      const msg = result.text ?? "Descreva brevemente o que aconteceu e onde você está agora.";
      setMessages([{ from: "ai", message: msg, sender: "IA Jurídica", timestamp: Date.now() }]);
    } catch {
      setMessages([{ from: "ai", message: "Descreva o que aconteceu enquanto conectamos você a um advogado.", sender: "IA Jurídica", timestamp: Date.now() }]);
    } finally {
      setIsAILoading(false);
    }
  };

  const sendTriageMessage = async (text: string) => {
    setMessages(prev => [...prev, { from: USER_ID, message: text, sender: "Você", timestamp: Date.now() }]);
    setIsAILoading(true);
    try {
      const result = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ parts: [{ text:
          `Emergência jurídica de ${selectedSpecialty}. Usuário disse: "${text}".
          Dê uma orientação preliminar de no máximo 2 parágrafos curtos.
          Seja direto. Tranquilize. Reforce que um advogado humano está sendo conectado agora.`
        }] }]
      });
      setMessages(prev => [...prev, { from: "ai", message: result.text ?? "Entendido.", sender: "IA Jurídica", timestamp: Date.now() }]);
    } catch { /* silencioso */ }
    finally { setIsAILoading(false); }
  };

  const sendChatMessage = (text: string) => {
    if (!socket || !activeEmergency?.lawyer_id) return;
    socket.emit("chat-message", {
      to: activeEmergency.lawyer_id,
      message: text,
      sender: "Cliente",
      emergencyId: activeEmergency.id,
    });
    setMessages(prev => [...prev, { from: USER_ID, message: text, sender: "Você", timestamp: Date.now() }]);
  };

  const activeLawyer = lawyers.find(l => l.id === activeEmergency?.lawyer_id);

  return (
    <div style={{
      minHeight: "100dvh",
      background: "#080810",
      color: "#F0EEE8",
      fontFamily: "'DM Sans', 'Inter', sans-serif",
      maxWidth: 430,
      margin: "0 auto",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40 }}
            style={{
              position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
              zIndex: 999, background: toast.type === "ok" ? "#1a3a2a" : "#3a1a1a",
              border: `1px solid ${toast.type === "ok" ? "#2d6b42" : "#6b2d2d"}`,
              color: toast.type === "ok" ? "#4ade80" : "#f87171",
              padding: "10px 20px", borderRadius: 12, fontSize: 13, fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px 8px", }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Shield size={16} color="#DC2626" />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: "#DC2626" }}>ADV24H</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: isOnline ? "#4ade80" : "#f87171" }}>
          {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
          {isOnline ? "Online" : "Sem conexão"}
        </div>
      </div>

      {/* Views */}
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.18 }}
        >
          {view === "home" && (
            <HomeView
              lawyers={lawyers}
              userLocation={userLocation}
              onEmergency={() => setView("specialty")}
              onMap={() => setView("map")}
              onHistory={() => setView("history")}
              onProfile={() => setView("profile")}
            />
          )}
          {view === "specialty" && (
            <SpecialtyView
              onBack={() => setView("home")}
              onSelect={handleEmergency}
            />
          )}
          {view === "emergency" && (
            <EmergencyView
              specialty={selectedSpecialty}
              messages={messages}
              isAILoading={isAILoading}
              timer={emergencyTimer}
              onSend={sendTriageMessage}
              onCancel={() => { setView("home"); setActiveEmergency(null); }}
            />
          )}
          {view === "chat" && (
            <ChatView
              messages={messages}
              lawyer={activeLawyer}
              onSend={sendChatMessage}
              onBack={() => setView("home")}
              role="client"
            />
          )}
          {view === "history" && (
            <HistoryView history={history} onBack={() => setView("home")} />
          )}
          {view === "profile" && (
            <ProfileView onBack={() => setView("home")} userId={USER_ID} />
          )}
          {view === "map" && (
            <MapView lawyers={lawyers} userLocation={userLocation} onBack={() => setView("home")} onEmergency={handleEmergency} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Bottom Nav */}
      {(view === "home") && (
        <nav style={{
          position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
          width: "100%", maxWidth: 430,
          background: "rgba(12,12,20,0.95)",
          backdropFilter: "blur(20px)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          padding: "12px 32px 24px",
          display: "flex", justifyContent: "space-around", alignItems: "center",
          zIndex: 40,
        }}>
          <NavBtn icon={<Shield size={22} />} label="Início" active onClick={() => setView("home")} />
          <NavBtn icon={<MapPin size={22} />} label="Mapa" onClick={() => setView("map")} />
          <NavBtn icon={<History size={22} />} label="Histórico" onClick={() => setView("history")} />
          <NavBtn icon={<User size={22} />} label="Perfil" onClick={() => setView("profile")} />
        </nav>
      )}
    </div>
  );
}

// ─── Home View ────────────────────────────────────────────────────────────────
function HomeView({ lawyers, userLocation, onEmergency, onMap, onHistory, onProfile }: any) {
  const available = lawyers.filter((l: Lawyer) => l.status === "available");
  return (
    <div style={{ padding: "8px 20px 120px" }}>
      {/* Hero */}
      <div style={{ textAlign: "center", padding: "32px 0 40px" }}>
        <motion.div
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          style={{
            width: 120, height: 120, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(220,38,38,0.15) 0%, transparent 70%)",
            border: "2px solid rgba(220,38,38,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 24px",
          }}
        >
          <Shield size={48} color="#DC2626" />
        </motion.div>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, margin: "0 0 8px" }}>
          Proteção jurídica<br />
          <span style={{ color: "#DC2626" }}>24 horas.</span>
        </h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", margin: 0 }}>
          {available.length} advogado{available.length !== 1 ? "s" : ""} disponível{available.length !== 1 ? "eis" : ""} agora
        </p>
      </div>

      {/* Botão emergência */}
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={onEmergency}
        style={{
          width: "100%", padding: "20px 0",
          background: "linear-gradient(135deg, #DC2626 0%, #991b1b 100%)",
          border: "none", borderRadius: 20, cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
          boxShadow: "0 0 40px rgba(220,38,38,0.35)",
          marginBottom: 16,
        }}
      >
        <AlertCircle size={32} color="white" />
        <span style={{ fontSize: 20, fontWeight: 800, color: "white", letterSpacing: 1 }}>EMERGÊNCIA</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontWeight: 400 }}>Falar com advogado agora</span>
      </motion.button>

      {/* Ações secundárias */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 32 }}>
        <ActionCard icon={<MapPin size={20} color="#60a5fa" />} label="Ver mapa" sub="Advogados próximos" onClick={onMap} color="#1e3a5f" />
        <ActionCard icon={<History size={20} color="#a78bfa" />} label="Histórico" sub="Seus atendimentos" onClick={onHistory} color="#2d1b5e" />
      </div>

      {/* Advogados disponíveis */}
      {available.length > 0 && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 12 }}>
            Disponíveis agora
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {available.slice(0, 3).map((l: Lawyer) => (
              <LawyerCard key={l.id} lawyer={l} onClick={() => {}} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Specialty View ───────────────────────────────────────────────────────────
function SpecialtyView({ onBack, onSelect }: any) {
  return (
    <div style={{ padding: "8px 20px 40px" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 14, padding: "8px 0 24px" }}>
        <ArrowLeft size={16} /> Voltar
      </button>
      <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 6 }}>Qual é a emergência?</h2>
      <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginBottom: 28 }}>Selecione para conectar ao advogado certo.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {SPECIALTIES.map(s => (
          <motion.button
            key={s.label}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(s.label)}
            style={{
              width: "100%", padding: "18px 20px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              color: "white", textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ fontSize: 28 }}>{s.icon}</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{s.label}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{s.desc}</div>
              </div>
            </div>
            <ChevronRight size={18} color="rgba(255,255,255,0.3)" />
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ─── Emergency View ───────────────────────────────────────────────────────────
function EmergencyView({ specialty, messages, isAILoading, timer, onSend, onCancel }: any) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const minutes = Math.floor(timer / 60).toString().padStart(2, "0");
  const seconds = (timer % 60).toString().padStart(2, "0");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isAILoading]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input);
    setInput("");
  };

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "12px 20px", background: "rgba(220,38,38,0.08)", borderBottom: "1px solid rgba(220,38,38,0.2)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#DC2626" }} />
            </motion.div>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#DC2626" }}>PROCURANDO ADVOGADO</span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{specialty} · {minutes}:{seconds}</div>
        </div>
        <button onClick={onCancel} style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 8, padding: "6px 12px", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 12 }}>
          Cancelar
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((msg: Message, i: number) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{ display: "flex", flexDirection: "column", alignItems: msg.sender === "Você" ? "flex-end" : "flex-start", maxWidth: "85%", alignSelf: msg.sender === "Você" ? "flex-end" : "flex-start" }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4, padding: "0 4px" }}>{msg.sender}</div>
            <div style={{
              padding: "12px 16px", borderRadius: msg.sender === "Você" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
              background: msg.sender === "Você" ? "#DC2626" : msg.sender === "IA Jurídica" ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.06)",
              border: msg.sender === "IA Jurídica" ? "1px solid rgba(99,102,241,0.3)" : "none",
              fontSize: 14, lineHeight: 1.5, color: "white",
            }}>
              {msg.message}
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 4, padding: "0 4px" }}>
              {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </motion.div>
        ))}
        {isAILoading && (
          <div style={{ display: "flex", gap: 4, padding: "12px 16px", background: "rgba(99,102,241,0.1)", borderRadius: "18px 18px 18px 4px", width: "fit-content", border: "1px solid rgba(99,102,241,0.2)" }}>
            {[0, 0.3, 0.6].map((d, i) => (
              <motion.div key={i} animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: d }}
                style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(99,102,241,0.8)" }} />
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: "12px 16px 32px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(12,12,20,0.95)", backdropFilter: "blur(20px)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "rgba(255,255,255,0.06)", borderRadius: 16, padding: "4px 4px 4px 16px", border: "1px solid rgba(255,255,255,0.08)" }}>
          <input
            value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder="Responda à triagem..."
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "white", fontSize: 14, padding: "8px 0" }}
          />
          <button onClick={handleSend} style={{ width: 36, height: 36, borderRadius: 12, background: "#DC2626", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Send size={16} color="white" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Chat View ────────────────────────────────────────────────────────────────
function ChatView({ messages, lawyer, onSend, onBack, role }: any) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input);
    setInput("");
  };

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)" }}><ArrowLeft size={20} /></button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{lawyer?.name ?? "Advogado"}</div>
          <div style={{ fontSize: 11, color: "#4ade80" }}>● Em atendimento</div>
        </div>
        <button style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10, width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Phone size={16} color="rgba(255,255,255,0.6)" />
        </button>
        <button style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10, width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Video size={16} color="rgba(255,255,255,0.6)" />
        </button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((msg: Message, i: number) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{ display: "flex", flexDirection: "column", alignItems: msg.sender === "Você" ? "flex-end" : "flex-start", maxWidth: "80%", alignSelf: msg.sender === "Você" ? "flex-end" : "flex-start" }}>
            <div style={{
              padding: "12px 16px",
              borderRadius: msg.sender === "Você" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
              background: msg.sender === "Você" ? "#1d4ed8" : "rgba(255,255,255,0.07)",
              border: msg.sender !== "Você" ? "1px solid rgba(255,255,255,0.08)" : "none",
              fontSize: 14, lineHeight: 1.5, color: "white",
            }}>
              {msg.message}
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 4, padding: "0 4px" }}>
              {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </motion.div>
        ))}
      </div>

      <div style={{ padding: "12px 16px 32px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(12,12,20,0.95)", backdropFilter: "blur(20px)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "rgba(255,255,255,0.06)", borderRadius: 16, padding: "4px 4px 4px 16px", border: "1px solid rgba(255,255,255,0.08)" }}>
          <input
            value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder="Digite sua mensagem..."
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "white", fontSize: 14, padding: "8px 0" }}
          />
          <button onClick={handleSend} style={{ width: 36, height: 36, borderRadius: 12, background: "#1d4ed8", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Send size={16} color="white" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Map View ────────────────────────────────────────────────────────────────
function MapView({ lawyers, userLocation, onBack, onEmergency }: any) {
  const available = lawyers.filter((l: Lawyer) => l.status === "available");
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)" }}><ArrowLeft size={20} /></button>
        <div>
          <div style={{ fontWeight: 700 }}>Mapa de advogados</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{available.length} disponíveis próximos</div>
        </div>
      </div>
      {/* Placeholder do mapa — integrar Mapbox/Google Maps */}
      <div style={{ flex: 1, background: "rgba(255,255,255,0.02)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Navigation size={40} color="rgba(255,255,255,0.15)" />
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", textAlign: "center", maxWidth: 240 }}>
          Integração com Mapbox em breve.<br />Sua localização já está sendo capturada.
        </p>
        {userLocation && (
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
            {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
          </div>
        )}
      </div>
      <div style={{ padding: "16px 20px 32px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Advogados disponíveis</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 200, overflowY: "auto" }}>
          {available.map((l: Lawyer) => (
            <LawyerCard key={l.id} lawyer={l} onClick={() => onEmergency(l.specialty)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── History View ─────────────────────────────────────────────────────────────
function HistoryView({ history, onBack }: any) {
  return (
    <div style={{ padding: "8px 20px 40px" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 14, padding: "8px 0 24px" }}>
        <ArrowLeft size={16} /> Voltar
      </button>
      <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 24 }}>Histórico</h2>
      {history.length === 0 ? (
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", padding: "60px 0", fontSize: 14 }}>Nenhum atendimento ainda.</div>
      ) : history.map((h: any, i: number) => (
        <div key={i} style={{ padding: "16px", background: "rgba(255,255,255,0.04)", borderRadius: 16, marginBottom: 10, border: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{h.specialty}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{new Date(h.created_at).toLocaleDateString("pt-BR")} · {h.lawyerName ?? "—"}</div>
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 8, background: h.status === "completed" ? "rgba(74,222,128,0.1)" : "rgba(96,165,250,0.1)", color: h.status === "completed" ? "#4ade80" : "#60a5fa", textTransform: "uppercase" }}>
            {h.status === "completed" ? "Concluído" : "Em andamento"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Profile View ─────────────────────────────────────────────────────────────
function ProfileView({ onBack, userId }: any) {
  return (
    <div style={{ padding: "8px 20px 40px" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 14, padding: "8px 0 24px" }}>
        <ArrowLeft size={16} /> Voltar
      </button>
      <div style={{ textAlign: "center", padding: "20px 0 32px" }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: "2px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <User size={36} color="rgba(255,255,255,0.3)" />
        </div>
        <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 4 }}>Minha Conta</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>{userId}</div>
      </div>
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 20 }}>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 12 }}>Autenticação completa com nome, e-mail e CPF em breve.</p>
        <button style={{ width: "100%", padding: "14px", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 12, color: "#f87171", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
          Fazer Login / Cadastro
        </button>
      </div>
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────
function NavBtn({ icon, label, active, onClick }: any) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, color: active ? "#DC2626" : "rgba(255,255,255,0.35)", fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>
      {icon}{label}
    </button>
  );
}

function ActionCard({ icon, label, sub, onClick, color }: any) {
  return (
    <motion.button whileTap={{ scale: 0.97 }} onClick={onClick} style={{ padding: "16px", background: color ?? "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, cursor: "pointer", textAlign: "left", color: "white" }}>
      <div style={{ marginBottom: 10 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{sub}</div>
    </motion.button>
  );
}

function LawyerCard({ lawyer, onClick }: { lawyer: Lawyer; onClick: () => void }) {
  return (
    <motion.button whileTap={{ scale: 0.98 }} onClick={onClick} style={{ width: "100%", padding: "14px 16px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", color: "white", textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Gavel size={18} color="rgba(255,255,255,0.5)" />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{lawyer.name}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
            {lawyer.specialty} {lawyer.distance !== undefined ? `· ${lawyer.distance}km` : ""}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#facc15" }}>
        <Star size={12} fill="#facc15" />
        {lawyer.rating}
      </div>
    </motion.button>
  );
}

// ─── Haversine (distância em km) ─────────────────────────────────────────────
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
