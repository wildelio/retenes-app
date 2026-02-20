// src/App.js
import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { supabase } from './supabase';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import 'leaflet/dist/leaflet.css';
import './App.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const createIcon = (color, size = 36) => L.divIcon({
  html: `<div style="width:${size}px;height:${size}px;background:${color};border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 3px 12px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);font-size:${size*0.4}px;">🚔</span></div>`,
  className: '',
  iconSize: [size, size],
  iconAnchor: [size/2, size],
  popupAnchor: [0, -size],
});

const RETEN_ICON = createIcon('#ef4444');
const RETEN_ICON_HOT = createIcon('#f97316', 42);
const TIPOS = ['Control vehicular', 'Alcoholemia', 'Documentos', 'Multas', 'Sin especificar'];

function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick(e.latlng) });
  return null;
}

export default function App() {
  const [reportes, setReportes] = useState([]);
  const [pendingLatLng, setPendingLatLng] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ tipo: TIPOS[0], descripcion: '' });
  const [loading, setLoading] = useState(false);
  const [commentInputs, setCommentInputs] = useState({});
  const [userToken] = useState(() => {
    let t = localStorage.getItem('reten_token');
    if (!t) { t = Math.random().toString(36).slice(2); localStorage.setItem('reten_token', t); }
    return t;
  });
  const [mapCenter] = useState([4.711, -74.0721]);
  const [gettingGPS, setGettingGPS] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Cargar reportes de las últimas 2 horas
  const cargarReportes = useCallback(async () => {
    const dosHorasAtras = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('reportes')
      .select('*')
      .gte('creado_en', dosHorasAtras)
      .order('creado_en', { ascending: false });
    if (!error && data) setReportes(data);
  }, []);

  useEffect(() => {
    cargarReportes();
    // Suscripción en tiempo real
    const channel = supabase
      .channel('reportes-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reportes' }, () => {
        cargarReportes();
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [cargarReportes]);

  const handleMapClick = useCallback((latlng) => {
    setPendingLatLng(latlng);
    setShowForm(true);
  }, []);

  const handleGPS = () => {
    setGettingGPS(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPendingLatLng({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setShowForm(true);
        setGettingGPS(false);
      },
      () => { showToast('No se pudo obtener tu ubicación', 'error'); setGettingGPS(false); }
    );
  };

  const submitReporte = async () => {
    if (!pendingLatLng) return;
    setLoading(true);
    const { error } = await supabase.from('reportes').insert({
      lat: pendingLatLng.lat,
      lng: pendingLatLng.lng,
      tipo: form.tipo,
      descripcion: form.descripcion,
      confirmaciones: 0,
      votos: JSON.stringify([]),
      comentarios: JSON.stringify([]),
      autor_token: userToken,
      creado_en: new Date().toISOString(),
    });
    if (!error) {
      showToast('✅ Retén reportado. ¡Gracias!');
      setShowForm(false);
      setPendingLatLng(null);
      setForm({ tipo: TIPOS[0], descripcion: '' });
      cargarReportes();
    } else {
      showToast('Error al guardar. Intenta de nuevo.', 'error');
    }
    setLoading(false);
  };

  const confirmar = async (reporte) => {
    const votos = JSON.parse(reporte.votos || '[]');
    if (votos.includes(userToken)) return;
    votos.push(userToken);
    await supabase.from('reportes').update({
      confirmaciones: (reporte.confirmaciones || 0) + 1,
      votos: JSON.stringify(votos),
    }).eq('id', reporte.id);
    showToast('👍 Confirmación enviada');
    cargarReportes();
  };

  const addComment = async (reporte) => {
    const text = commentInputs[reporte.id]?.trim();
    if (!text) return;
    const comentarios = JSON.parse(reporte.comentarios || '[]');
    comentarios.push({ texto: text, ts: Date.now(), autor: userToken.slice(0, 6) });
    await supabase.from('reportes').update({
      comentarios: JSON.stringify(comentarios),
    }).eq('id', reporte.id);
    setCommentInputs(prev => ({ ...prev, [reporte.id]: '' }));
    cargarReportes();
  };

  const timeAgo = (ts) => {
    if (!ts) return '';
    return formatDistanceToNow(new Date(ts), { addSuffix: true, locale: es });
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <span className="logo-icon">🚔</span>
            <div>
              <h1>RetenApp</h1>
              <span className="tagline">Reportes ciudadanos en tiempo real</span>
            </div>
          </div>
          <div className="stats">
            <span className="badge">{reportes.length} activos</span>
          </div>
        </div>
      </header>

      <div className="map-wrapper">
        <MapContainer center={mapCenter} zoom={13} className="map">
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />
          <MapClickHandler onMapClick={handleMapClick} />

          {reportes.map(r => {
            const votos = JSON.parse(r.votos || '[]');
            const comentarios = JSON.parse(r.comentarios || '[]');
            return (
              <Marker
                key={r.id}
                position={[r.lat, r.lng]}
                icon={r.confirmaciones >= 3 ? RETEN_ICON_HOT : RETEN_ICON}
              >
                <Popup className="custom-popup" maxWidth={300}>
                  <div className="popup-content">
                    <div className="popup-header">
                      <span className="popup-tipo">{r.tipo}</span>
                      {r.confirmaciones >= 3 && <span className="hot-badge">🔥 Confirmado</span>}
                    </div>
                    {r.descripcion && <p className="popup-desc">{r.descripcion}</p>}
                    <div className="popup-meta">
                      <span>🕐 {timeAgo(r.creado_en)}</span>
                      <button
                        className={`btn-confirm ${votos.includes(userToken) ? 'voted' : ''}`}
                        onClick={() => confirmar(r)}
                      >
                        {votos.includes(userToken) ? '✓ Confirmado' : `👍 Confirmar (${r.confirmaciones || 0})`}
                      </button>
                    </div>
                    <div className="comments-section">
                      <span className="comments-title">Comentarios ({comentarios.length})</span>
                      <div className="comments-list">
                        {comentarios.slice(-3).map((c, i) => (
                          <div key={i} className="comment">
                            <span className="comment-autor">#{c.autor}</span>
                            <span className="comment-text">{c.texto}</span>
                          </div>
                        ))}
                      </div>
                      <div className="comment-input-row">
                        <input
                          type="text"
                          placeholder="Añadir comentario..."
                          maxLength={120}
                          value={commentInputs[r.id] || ''}
                          onChange={e => setCommentInputs(prev => ({ ...prev, [r.id]: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && addComment(r)}
                        />
                        <button onClick={() => addComment(r)}>→</button>
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        <div className="fab-group">
          <button className="fab gps-btn" onClick={handleGPS} disabled={gettingGPS}>
            {gettingGPS ? '⌛' : '📍'}
          </button>
          <button className="fab report-btn" onClick={() => { setPendingLatLng(null); setShowForm(true); }}>
            + Reportar retén
          </button>
        </div>

        <div className="map-hint">
          Toca el mapa para marcar la ubicación del retén, o usa 📍 para tu posición
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🚔 Reportar Retén</h2>
              <button className="close-btn" onClick={() => setShowForm(false)}>✕</button>
            </div>
            {!pendingLatLng ? (
              <div className="location-prompt">
                <p>Primero elige la ubicación:</p>
                <button className="btn-secondary" onClick={() => setShowForm(false)}>🗺 Tocar en el mapa</button>
                <button className="btn-secondary" onClick={handleGPS}>📍 Usar mi GPS</button>
              </div>
            ) : (
              <>
                <div className="location-confirmed">
                  📍 Ubicación: {pendingLatLng.lat.toFixed(4)}, {pendingLatLng.lng.toFixed(4)}
                </div>
                <div className="form-group">
                  <label>Tipo de retén</label>
                  <div className="tipo-grid">
                    {TIPOS.map(t => (
                      <button key={t} className={`tipo-btn ${form.tipo === t ? 'active' : ''}`} onClick={() => setForm(f => ({ ...f, tipo: t }))}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label>Descripción (opcional)</label>
                  <textarea
                    placeholder="Ej: Están revisando papeles y SOAT, hay 3 agentes..."
                    maxLength={200}
                    value={form.descripcion}
                    onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  />
                </div>
                <div className="form-footer">
                  <span className="disclaimer">⚠️ El reporte expira automáticamente en 2 horas</span>
                  <button className="btn-primary" onClick={submitReporte} disabled={loading}>
                    {loading ? 'Enviando...' : '🚨 Publicar alerta'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
