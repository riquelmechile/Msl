import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import type { CreativeAssetRequest, CreativeExecutionResult } from "@msl/creative-studio";
import {
  PolicyEngine,
  CostLedger,
  MinimaxClient,
  MinimaxImageProvider,
  MinimaxVideoProvider,
  CreativeAssetStore,
  MlDiagnosticAdapter,
  CortexBridge,
} from "@msl/creative-studio";
import type { CortexSink } from "@msl/creative-studio";
import type { GraphEngine } from "@msl/memory";

// ── Environment helpers ─────────────────────────────────────────────

function env(name: string, fallback = ""): string {
  return (globalThis as Record<string, unknown>).process
    ? ((globalThis as typeof globalThis & { process: { env: Record<string, string | undefined> } })
        .process.env[name] ?? fallback)
    : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = env(name);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ── Concurrency gate (module-level state) ────────────────────────────

/** Reset concurrency gate state (exported for testing). */
export function resetConcurrencyGate(): void {
  activeJobs = 0;
  lastJobTime = 0;
}

/** Set the last job timestamp (exported for testing). */
export function setLastJobTime(ts: number): void {
  lastJobTime = ts;
}

/** Number of currently active generation jobs. */
let activeJobs = 0;

/** Timestamp (ms) of the last generation call. */
let lastJobTime = 0;

function concurrencyGateAllowed(): boolean {
  const maxConcurrent = envNumber("MSL_CREATIVE_STUDIO_MAX_CONCURRENT_JOBS", 3);
  const minCooldownMs = envNumber("MSL_CREATIVE_STUDIO_MIN_COOLDOWN_MS", 2000);

  if (activeJobs >= maxConcurrent) {
    console.warn(
      `[creative-studio] Concurrency limit reached (${activeJobs}/${maxConcurrent}) — skipping claim`,
    );
    return false;
  }

  const elapsed = Date.now() - lastJobTime;
  if (elapsed < minCooldownMs) {
    console.warn(
      `[creative-studio] Cooldown active (${elapsed}ms < ${minCooldownMs}ms) — skipping claim`,
    );
    return false;
  }

  return true;
}

function acquireConcurrencySlot(): void {
  activeJobs++;
  lastJobTime = Date.now();
}

function releaseConcurrencySlot(): void {
  if (activeJobs > 0) activeJobs--;
}

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Creative Studio daemon handler.
 *
 * Processes creative asset requests addressed to `receiverAgentId: "creative-studio"`.
 * Follows a request → execute → respond lifecycle:
 *
 * 1. Parse the claimed message payload as `CreativeAssetRequest`
 * 2. Check env gate — return empty findings if MSL_CREATIVE_STUDIO_ENABLED != "true"
 * 3. Validate request via PolicyEngine
 * 4. Check budget via CostLedger
 * 5. Route to MiniMax provider (image or video) based on job kind
 * 6. Execute generation
 * 7. Save assets via CreativeAssetStore (when output has downloadable URLs)
 * 8. Enqueue CEO proposal with the result
 */
/**
 * Create a CortexBridge instance from the daemon context.
 * Exported for testing — allows injection of a custom CortexSink.
 */
export function createCortexBridge(cortex: GraphEngine): CortexSink {
  return new CortexBridge(cortex);
}

export const creativeStudioDaemon: DaemonHandler = async ({
  claim,
  reader: _reader,
  cortex,
  bus,
  sellerIds: _sellerIds,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  // ── 1. Env gate ──────────────────────────────────────────────
  if (env("MSL_CREATIVE_STUDIO_ENABLED") !== "true") {
    return { findings, proposalEnqueued: false, messageIds };
  }

  const apiKey = env("MINIMAX_API_KEY");
  if (!apiKey) {
    console.warn("[creative-studio] MINIMAX_API_KEY not set — returning empty findings");
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 2. Parse request ─────────────────────────────────────────
  let request: CreativeAssetRequest;
  try {
    request = JSON.parse(claim.payloadJson) as CreativeAssetRequest;
  } catch {
    console.error(`[creative-studio] Failed to parse payload for message ${claim.messageId}`);
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Creative Studio: invalid payload — could not parse CreativeAssetRequest",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 3. Policy check ──────────────────────────────────────────
  const policy = new PolicyEngine();
  const validation = policy.validate(request);
  if (!validation.valid) {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: `Creative Studio: policy validation failed — ${validation.issues.join("; ")}`,
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 4. Budget check ──────────────────────────────────────────
  const maxDailyUsd = envNumber("MSL_CREATIVE_STUDIO_MAX_DAILY_USD", 5.0);
  const maxJobUsd = envNumber("MSL_CREATIVE_STUDIO_MAX_JOB_USD", 0.5);
  const ledger = new CostLedger({ maxDailyUsd, maxJobUsd });

  const apiHost = env("MINIMAX_API_HOST", "https://api.minimax.io");
  const timeoutMs = envNumber("MINIMAX_REQUEST_TIMEOUT_MS", 120000);
  const client = new MinimaxClient({ apiKey, apiHost, timeoutMs });

  // Pick the right provider
  const imageProvider = new MinimaxImageProvider(client);
  const videoProvider = new MinimaxVideoProvider(client);

  let provider: MinimaxImageProvider | MinimaxVideoProvider;
  if (imageProvider.supports(request.kind)) {
    provider = imageProvider;
  } else if (videoProvider.supports(request.kind)) {
    provider = videoProvider;
  } else {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: `Creative Studio: unsupported job kind "${request.kind}"`,
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  const estimatedCost = provider.estimate(request);

  const budgetCheck = ledger.canAfford(estimatedCost);
  if (!budgetCheck.allowed) {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: `Creative Studio: budget check failed — ${budgetCheck.reason}`,
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 5. Concurrency gate ──────────────────────────────────────
  if (!concurrencyGateAllowed()) {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Creative Studio: concurrency limit or cooldown active — skipping",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 6. Execute ───────────────────────────────────────────────
  acquireConcurrencySlot();
  let result: CreativeExecutionResult;
  try {
    result = await provider.execute(request);
  } catch (err) {
    releaseConcurrencySlot();
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[creative-studio] Provider execution failed: ${errorMessage}`);
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: `Creative Studio: generation failed — ${errorMessage}`,
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }
  releaseConcurrencySlot();

  // ── 6. Record spend (successful only) ────────────────────────
  if (result.actualCostUsd !== undefined) {
    ledger.recordSpend(result.actualCostUsd);
  }

  // ── 7. ML Diagnosis (for MercadoLibre channel) ──────────────
  const autoDiagnose = env("MSL_CREATIVE_STUDIO_ML_AUTO_DIAGNOSE", "true");
  if (
    request.channel === "mercadolibre" &&
    autoDiagnose === "true" &&
    result.outputs.length > 0 &&
    result.outputs.some((o) => o.storageUri)
  ) {
    const mlApiToken = env("ML_API_TOKEN");
    const mlApiBaseUrl = env("ML_API_BASE_URL", "https://api.mercadolibre.com");

    // Only diagnose if we have an ML API token
    if (mlApiToken) {
      const diagnosticAdapter = new MlDiagnosticAdapter({
        mlApiBaseUrl,
        authToken: mlApiToken,
      });

      const pictureType = request.constraints.channelFormat?.ml?.pictureType ?? "thumbnail";
      const categoryId =
        request.productContext?.categoryId ??
        request.constraints.channelFormat?.ml?.expectedCategoryId ??
        "";
      const title = request.productContext?.title ?? "";

      for (const output of result.outputs) {
        if (output.storageUri && output.kind === "image") {
          try {
            const diagResult = await diagnosticAdapter.diagnoseImage(output.storageUri, {
              categoryId,
              title,
              pictureType,
            });
            // Attach diagnostic to the output
            (output as { mlDiagnostic?: unknown }).mlDiagnostic = diagResult;
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.warn(
              `[creative-studio] ML diagnosis failed for ${output.assetId}: ${errorMessage}`,
            );
            // Non-blocking — leave mlDiagnostic undefined
          }
        }
      }
    }
  }

  // ── 8. Save assets locally (for URL-based outputs) ────────────
  if (result.outputs.length > 0) {
    const store = new CreativeAssetStore(
      env("MSL_CREATIVE_STUDIO_STORAGE_PATH", ".msl/creative-studio/assets"),
    );

    for (const output of result.outputs) {
      // If storageUri is a remote URL, try to download and persist locally
      if (output.storageUri.startsWith("http")) {
        try {
          const response = await fetch(output.storageUri);
          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            const localUri = await store.saveAsset(output.assetId, buffer, {
              sourceUri: output.storageUri,
              jobId: result.jobId,
              requestId: result.requestId,
              kind: output.kind,
              provider: result.provider,
              model: result.model,
              capturedAt: new Date().toISOString(),
            });
            // Update the output to point to local storage
            (output as { storageUri: string }).storageUri = localUri;
          }
        } catch (err) {
          console.warn(
            `[creative-studio] Failed to download asset ${output.assetId}: ${err instanceof Error ? err.message : String(err)}`,
          );
          // Non-blocking — keep the remote URL as fallback
        }
      }
    }
  }

  // ── 9. Enqueue CEO proposal ──────────────────────────────────
  const payload: Record<string, unknown> = {
    type: "proposal",
    summary: `Creative Studio: generated ${result.outputs.length} asset(s) for ${request.kind} on ${request.channel}`,
    result,
    requestId: request.requestId,
    kind: request.kind,
    channel: request.channel,
    cost: result.actualCostUsd ?? result.estimatedCostUsd,
    noMutationExecuted: true,
    nextAction: "approve_creative_asset",
    capturedAt: new Date().toISOString(),
  };

  const message = bus.enqueue({
    senderAgentId: "creative-studio",
    receiverAgentId: "ceo",
    messageType: "proposal",
    payloadJson: JSON.stringify(payload),
    dedupeKey: `creative-studio-${request.requestId}`,
  });
  messageIds.push(message.messageId);

  // ── 10. Record outcome in Cortex ─────────────────────────────
  try {
    const cortexBridge = createCortexBridge(cortex);
    await cortexBridge.recordOutcome(result.jobId, result, {
      approved: false,
      published: false,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[creative-studio] Failed to record Cortex outcome: ${errorMessage}`);
    // Non-blocking
  }

  // ── 11. Audit log ────────────────────────────────────────────
  const auditEvent = {
    jobId: result.jobId,
    requestId: result.requestId,
    provider: result.provider,
    model: result.model,
    estimatedCostUsd: result.estimatedCostUsd,
    actualCostUsd: result.actualCostUsd,
    channel: request.channel,
    kind: request.kind,
    timestamp: new Date().toISOString(),
    status: result.status,
  };
  console.log(JSON.stringify(auditEvent));

  // ── 12. Build findings ───────────────────────────────────────
  if (result.outputs.length > 0) {
    for (const output of result.outputs) {
      const diagInfo =
        output.mlDiagnostic && !output.mlDiagnostic.passed
          ? ` [diagnostic: ${output.mlDiagnostic.detections.map((d) => d.name).join(", ")}]`
          : "";
      findings.push({
        kind: "opportunity",
        severity: "info",
        summary: `Creative Studio: ${output.kind} asset ready — ${output.storageUri}${diagInfo}`,
        evidenceIds: [claim.messageId, output.assetId],
      });
    }
  }

  return {
    findings,
    proposalEnqueued: true,
    messageIds,
  };
};
