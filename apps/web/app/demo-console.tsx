"use client";

import { useState } from "react";
import type { DemoViewModel } from "./demo";

type DemoConsoleProps = {
  demo: DemoViewModel;
};

export function DemoConsole({ demo }: DemoConsoleProps) {
  const [connected, setConnected] = useState(false);
  const [showReconnect, setShowReconnect] = useState(false);
  const [actionApproved, setActionApproved] = useState(false);
  const [creativeApproved, setCreativeApproved] = useState(false);

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">MercadoLibre Chile · Demo segura</p>
        <h1>Agente de negocio para vendedores MLC</h1>
        <p>
          Chat determinístico con recomendaciones, conexión de cuenta simulada, aprobaciones,
          auditoría y vista previa creativa. No usa credenciales reales ni publica cambios.
        </p>
      </header>

      {/* ── Conversational agent banner ─────────────────────────── */}
      <section className="card wide conversation-banner" aria-labelledby="conv-banner-title">
        <div className="conv-banner-content">
          <div>
            <h2 id="conv-banner-title">💬 Agente Conversacional — Plasticov AI</h2>
            <p>
              Probá el nuevo asistente conversacional con las 7 fases del stack completo:{" "}
              <strong>Cortex</strong> (memoria y grafos), <strong>estrategias del CEO</strong>,{" "}
              <strong>actores del mercado</strong> (comprador, proveedor, competidor),{" "}
              <strong>motor de autonomía</strong> (5 niveles), contrainteligencia y más.
            </p>
            <ul className="conv-capabilities">
              <li>🧠 Memoria Cortex con grafos y aprendizaje Hebbiano</li>
              <li>📐 Estrategias del CEO inyectadas en cada respuesta</li>
              <li>🛒 Simulación de actores: comprador, proveedor, competidor</li>
              <li>🔒 5 niveles de autonomía (CONSULTA → FULL)</li>
              <li>🕵️ Detección de contrainteligencia y honey-pots</li>
              <li>⚡ Preparación de acciones con confirmación &ldquo;dale&rdquo;</li>
              <li>📊 KPI tracking y degradación automática de autonomía</li>
            </ul>
          </div>
          <div className="conv-banner-action">
            <a href="/conversation" className="conv-banner-link">
              Ir al chat →
            </a>
          </div>
        </div>
      </section>

      <section className="grid" aria-label="Panel principal del agente">
        <article className="card" aria-labelledby="chat-title">
          <h2 id="chat-title">Chat de negocio</h2>
          <div className="chat" aria-label="Conversación del agente">
            <p className="seller">¿Conviene bajar el precio del producto con más visitas?</p>
            <div className="agent">
              <strong>{demo.advice.answer}</strong>
              <p>{demo.advice.recommendation}</p>
              <ul>
                {demo.advice.rationale.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          </div>
        </article>

        <article className="card" aria-labelledby="connection-title">
          <h2 id="connection-title">Conexión MercadoLibre</h2>
          <p>
            Estado: {connected ? `Conectado a ${demo.access.connectedSite}` : "Sin conexión activa"}
          </p>
          <div className="actions">
            <button type="button" onClick={() => setConnected(true)}>
              Conectar MercadoLibre
            </button>
            <button type="button" className="secondary" onClick={() => setShowReconnect(true)}>
              Ver datos protegidos
            </button>
          </div>
          {showReconnect ? (
            <p role="alert" className="warning">
              {connected ? "Datos protegidos disponibles para MLC." : demo.access.revokedMessage}
            </p>
          ) : null}
        </article>

        <article className="card wide" aria-labelledby="summary-title">
          <h2 id="summary-title">Resumen diario</h2>
          <p>Generado: {new Date(demo.summary.generatedAt).toLocaleString("es-CL")}</p>
          <ol className="priorities">
            {demo.summary.priorities.map((priority) => (
              <li key={priority.title}>
                <h3>
                  Prioridad {priority.rank}: {priority.title}
                </h3>
                <p>{priority.reason}</p>
                <p>{priority.tradeoff}</p>
                <p>Confianza: {priority.confidence}</p>
                {priority.staleDataDisclosure ? (
                  <p className="warning">{priority.staleDataDisclosure}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </article>

        <article className="card" aria-labelledby="approval-title">
          <h2 id="approval-title">Revisión de acción preparada</h2>
          <p>Acción: {demo.action.id}</p>
          <p>Cambio exacto: {demo.action.exactChange}</p>
          <p>Motivo: {demo.action.rationale}</p>
          <p className="warning">Riesgo: {demo.action.risk}</p>
          {!actionApproved ? <p role="status">{demo.action.blockedAudit}</p> : null}
          <button type="button" onClick={() => setActionApproved(true)}>
            Aprobar acción preparada
          </button>
          {actionApproved ? (
            <section className="audit" aria-label="Auditoría de acción aprobada">
              <h3>Auditoría registrada</h3>
              <p>Aprobado por vendedor. Resultado simulado: ejecutado sin llamar APIs reales.</p>
              <p>Se registró quién aprobó, qué cambió, por qué y el riesgo aceptado.</p>
            </section>
          ) : null}
        </article>

        <article className="card" aria-labelledby="creative-title">
          <h2 id="creative-title">Vista previa creativa</h2>
          <h3>{demo.creative.title}</h3>
          <p>Uso previsto: {demo.creative.usageIntent}</p>
          <p>Beneficio esperado: {demo.creative.expectedListingBenefit}</p>
          <ol>
            {demo.creative.storyboard.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="warning">{demo.creative.publicationStatus}</p>
          <button type="button" onClick={() => setCreativeApproved(true)}>
            Aprobar publicación creativa
          </button>
          {creativeApproved ? (
            <p role="status">Aprobación creativa registrada; publicación real fuera de alcance.</p>
          ) : null}
        </article>
      </section>
    </main>
  );
}
