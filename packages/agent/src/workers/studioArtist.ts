import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import {
  enqueueProductLaunchResult,
  parseProductLaunchEnvelope,
  type ProductLaunchEnvelope,
} from "./productLaunchEnvelope.js";
import type { CreativeAssetRequest, CreativeJobKind, CreativeChannel } from "@msl/creative-studio";
import { CostLedger } from "@msl/creative-studio";
import type { ImageQualityDecision } from "@msl/domain";

// ── Environment helpers ─────────────────────────────────────────────

function env(name: string, fallback = ""): string {
  return (globalThis as Record<string, unknown>).process
    ? ((globalThis as typeof globalThis & { process: { env: Record<string, string | undefined> } })
        .process.env[name] ?? fallback)
    : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ── Input / Output types ─────────────────────────────────────────────

export type StudioArtistInput = {
  /** Original product image URL. */
  imageUrl: string;
  /** Quality decision from PhotoDirector. */
  qualityDecision: ImageQualityDecision;
  /** Reference URLs for MiniMax (from ImageScout or original image). */
  referenceUrls: string[];
  /** Product context for creative asset request. */
  productContext: {
    title: string;
    kind?: string;
    channel?: string;
  };
};

export type StudioArtistOutput = {
  /** Final generated or reused image URLs. */
  generatedUrls: string[];
  /** Whether MiniMax was actually called (false when score >= 80). */
  usedMiniMax: boolean;
  /** Estimated cost in USD (0 when MiniMax was skipped). */
  costUsd: number;
};

// ── Cost estimation ──────────────────────────────────────────────────

const MINIMAX_IMAGE_COST_USD = 0.05;

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Studio Artist daemon handler.
 *
 * Processes creative-production messages from the agent bus.
 * Claims messages with `receiverAgentId: "creative-production"`.
 *
 * 1. Parse the claimed message payload as StudioArtistInput
 * 2. Route based on PhotoDirector's quality decision:
 *    - USE_AS_REFERENCE (score >= 80): skip MiniMax, return original image URL
 *    - REGENERATE (score 40-79): enqueue CreativeAssetRequest to creative-studio lane with original as subject_reference
 *    - DISCARD_AND_SEARCH (score < 40): enqueue CreativeAssetRequest to creative-studio lane with ImageScout URLs as references
 * 3. Track costs via CostLedger
 * 4. Stub mode: when MiniMax unavailable → return input image URLs as-is
 */
export const studioArtist: DaemonHandler = ({ claim, bus, launchCostTracker }) =>
  Promise.resolve(
    (() => {
      const findings: DaemonFinding[] = [];
      const messageIds: string[] = [];

      // ── 1. Parse input ────────────────────────────────────────────
      let input: StudioArtistInput;
      try {
        input = JSON.parse(claim.payloadJson) as StudioArtistInput;
      } catch {
        findings.push({
          kind: "alert",
          severity: "warning",
          summary: "Studio Artist: invalid payload — could not parse StudioArtistInput",
          evidenceIds: [claim.messageId],
        });
        return { findings, proposalEnqueued: false, messageIds };
      }
      const parsedLaunchEnvelope = parseProductLaunchEnvelope(claim);
      if (parsedLaunchEnvelope) {
        input.imageUrl = parsedLaunchEnvelope.imageUrls[0] ?? "";
        input.qualityDecision = parsedLaunchEnvelope.qualityDecision!;
        input.referenceUrls = parsedLaunchEnvelope.referenceUrls ?? [];
        input.productContext = {
          title: [parsedLaunchEnvelope.brand, parsedLaunchEnvelope.model].filter(Boolean).join(" "),
        };
      }

      if (!input.imageUrl) {
        findings.push({
          kind: "alert",
          severity: "warning",
          summary: "Studio Artist: missing imageUrl in payload",
          evidenceIds: [claim.messageId],
        });
        return { findings, proposalEnqueued: false, messageIds };
      }

      if (!input.qualityDecision) {
        findings.push({
          kind: "alert",
          severity: "warning",
          summary: "Studio Artist: missing qualityDecision in payload",
          evidenceIds: [claim.messageId],
        });
        return { findings, proposalEnqueued: false, messageIds };
      }

      // ── 2. Route based on quality decision ────────────────────────
      const miniMaxEnabled =
        env("MSL_CREATIVE_STUDIO_ENABLED") === "true" && !!env("MINIMAX_API_KEY");
      const maxDailyUsd = envNumber("MSL_CREATIVE_STUDIO_MAX_DAILY_USD", 5.0);
      const maxJobUsd = envNumber("MSL_CREATIVE_STUDIO_MAX_JOB_USD", 0.5);
      const costLedger = new CostLedger({ maxDailyUsd, maxJobUsd });
      const launchBudget =
        parsedLaunchEnvelope && launchCostTracker
          ? launchCostTracker.canAfford(
              parsedLaunchEnvelope.launchId,
              parsedLaunchEnvelope.sellerId,
              MINIMAX_IMAGE_COST_USD,
            )
          : { allowed: true as const };

      let output: StudioArtistOutput;

      switch (input.qualityDecision) {
        case "USE_AS_REFERENCE": {
          // Image is good enough — skip MiniMax entirely
          output = {
            generatedUrls: [input.imageUrl],
            usedMiniMax: false,
            costUsd: 0,
          };

          findings.push({
            kind: "info",
            severity: "info",
            summary: "Studio Artist: USE_AS_REFERENCE — skipping MiniMax, using original image",
            evidenceIds: [claim.messageId],
          });
          break;
        }

        case "REGENERATE": {
          // Use original image as subject_reference for MiniMax
          if (!miniMaxEnabled) {
            console.warn(
              "[studio-artist] MiniMax not available — returning original image as-is (stub mode)",
            );
            output = {
              generatedUrls: [input.imageUrl],
              usedMiniMax: false,
              costUsd: 0,
            };

            findings.push({
              kind: "info",
              severity: "info",
              summary: "Studio Artist: REGENERATE stub — MiniMax unavailable, returning original",
              evidenceIds: [claim.messageId],
            });
            break;
          }

          if (!launchBudget.allowed) {
            findings.push({
              kind: "alert",
              severity: "warning",
              summary: `Studio Artist: ${launchBudget.reason}`,
              evidenceIds: [claim.messageId],
            });
            output = { generatedUrls: [input.imageUrl], usedMiniMax: false, costUsd: 0 };
            break;
          }

          // Check budget
          const budgetCheck = costLedger.canAfford(MINIMAX_IMAGE_COST_USD);
          if (!budgetCheck.allowed) {
            findings.push({
              kind: "alert",
              severity: "warning",
              summary: `Studio Artist: budget check failed — ${budgetCheck.reason}`,
              evidenceIds: [claim.messageId],
            });
            output = {
              generatedUrls: [input.imageUrl],
              usedMiniMax: false,
              costUsd: 0,
            };
            break;
          }

          // Enqueue to creative-studio lane
          const requestId = `studio-artist-${claim.messageId}`;
          const creativeRequest = buildCreativeAssetRequest({
            requestId,
            imageUrl: input.imageUrl,
            productContext: input.productContext,
            referenceUrls: [input.imageUrl],
            sellerId: parsedLaunchEnvelope?.sellerId,
            launchEnvelope: parsedLaunchEnvelope,
          });

          const msg = bus.enqueue({
            senderAgentId: "creative-production",
            receiverAgentId: "creative-studio",
            messageType: "creative-asset-request",
            payloadJson: JSON.stringify(creativeRequest),
            dedupeKey: requestId,
            ...(parsedLaunchEnvelope
              ? {
                  correlationId: parsedLaunchEnvelope.launchId,
                  parentMessageId: claim.messageId,
                  sellerId: parsedLaunchEnvelope.sellerId,
                }
              : {}),
          });
          messageIds.push(msg.messageId);

          output = {
            generatedUrls: [],
            usedMiniMax: true,
            costUsd: 0,
          };

          findings.push({
            kind: "opportunity",
            severity: "info",
            summary:
              "Studio Artist: REGENERATE — enqueued MiniMax request with original as subject_reference",
            evidenceIds: [claim.messageId, msg.messageId],
          });
          break;
        }

        case "DISCARD_AND_SEARCH": {
          if (!miniMaxEnabled) {
            console.warn(
              "[studio-artist] MiniMax not available — returning reference URLs as-is (stub mode)",
            );
            output = {
              generatedUrls:
                input.referenceUrls.length > 0 ? input.referenceUrls : [input.imageUrl],
              usedMiniMax: false,
              costUsd: 0,
            };

            findings.push({
              kind: "info",
              severity: "info",
              summary:
                "Studio Artist: DISCARD_AND_SEARCH stub — MiniMax unavailable, returning reference URLs",
              evidenceIds: [claim.messageId],
            });
            break;
          }

          if (!launchBudget.allowed) {
            findings.push({
              kind: "alert",
              severity: "warning",
              summary: `Studio Artist: ${launchBudget.reason}`,
              evidenceIds: [claim.messageId],
            });
            output = {
              generatedUrls:
                input.referenceUrls.length > 0 ? input.referenceUrls : [input.imageUrl],
              usedMiniMax: false,
              costUsd: 0,
            };
            break;
          }

          // Check budget
          const budgetCheck = costLedger.canAfford(MINIMAX_IMAGE_COST_USD);
          if (!budgetCheck.allowed) {
            findings.push({
              kind: "alert",
              severity: "warning",
              summary: `Studio Artist: budget check failed — ${budgetCheck.reason}`,
              evidenceIds: [claim.messageId],
            });
            output = {
              generatedUrls:
                input.referenceUrls.length > 0 ? input.referenceUrls : [input.imageUrl],
              usedMiniMax: false,
              costUsd: 0,
            };
            break;
          }

          // Use ImageScout URLs as subject_reference — pick first valid URL
          const scoutUrl =
            input.referenceUrls.length > 0 ? input.referenceUrls[0]! : input.imageUrl;
          const requestId = `studio-artist-${claim.messageId}`;
          const creativeRequest = buildCreativeAssetRequest({
            requestId,
            imageUrl: scoutUrl,
            productContext: input.productContext,
            referenceUrls: input.referenceUrls.length > 0 ? input.referenceUrls : [input.imageUrl],
            sellerId: parsedLaunchEnvelope?.sellerId,
            launchEnvelope: parsedLaunchEnvelope,
          });

          const msg = bus.enqueue({
            senderAgentId: "creative-production",
            receiverAgentId: "creative-studio",
            messageType: "creative-asset-request",
            payloadJson: JSON.stringify(creativeRequest),
            dedupeKey: requestId,
            ...(parsedLaunchEnvelope
              ? {
                  correlationId: parsedLaunchEnvelope.launchId,
                  parentMessageId: claim.messageId,
                  sellerId: parsedLaunchEnvelope.sellerId,
                }
              : {}),
          });
          messageIds.push(msg.messageId);

          output = {
            generatedUrls: [],
            usedMiniMax: true,
            costUsd: 0,
          };

          findings.push({
            kind: "opportunity",
            severity: "info",
            summary:
              "Studio Artist: DISCARD_AND_SEARCH — enqueued MiniMax request with ImageScout URLs as references",
            evidenceIds: [claim.messageId, msg.messageId],
          });
          break;
        }

        default: {
          findings.push({
            kind: "alert",
            severity: "warning",
            summary: `Studio Artist: unknown quality decision "${String(input.qualityDecision)}" — falling back to original image`,
            evidenceIds: [claim.messageId],
          });
          output = {
            generatedUrls: [input.imageUrl],
            usedMiniMax: false,
            costUsd: 0,
          };
        }
      }

      // ── 3. Enqueue result ─────────────────────────────────────────
      const launchEnvelope = parsedLaunchEnvelope;
      if (launchEnvelope) {
        if (output.usedMiniMax) {
          return { findings, proposalEnqueued: true, messageIds };
        }
        const message = enqueueProductLaunchResult(bus, claim, launchEnvelope, {
          images: output.generatedUrls.length > 0 ? output.generatedUrls : [input.imageUrl],
        });
        messageIds.push(message.messageId);
        return { findings, proposalEnqueued: true, messageIds };
      }

      const resultPayload: Record<string, unknown> = {
        type: "finding",
        summary: `Studio Artist: ${output.usedMiniMax ? "MiniMax requested" : "no MiniMax needed"} — ${output.generatedUrls.length} URL(s)`,
        studioArtistResult: output,
        qualityDecision: input.qualityDecision,
        noMutationExecuted: true,
        capturedAt: new Date().toISOString(),
      };

      const resultMsg = bus.enqueue({
        senderAgentId: "creative-production",
        receiverAgentId: "creative-production",
        messageType: "finding",
        payloadJson: JSON.stringify(resultPayload),
        dedupeKey: `studio-artist-result-${claim.messageId}`,
      });
      messageIds.push(resultMsg.messageId);

      return { findings, proposalEnqueued: true, messageIds };
    })(),
  );

// ── Helpers ──────────────────────────────────────────────────────────

function buildCreativeAssetRequest(params: {
  requestId: string;
  imageUrl: string;
  productContext: StudioArtistInput["productContext"];
  referenceUrls: string[];
  sellerId?: string | undefined;
  launchEnvelope?: ProductLaunchEnvelope | undefined;
}): CreativeAssetRequest & { productLaunch?: ProductLaunchEnvelope } {
  const channel: CreativeChannel =
    (params.productContext.channel as CreativeChannel) ?? "mercadolibre";
  const kind: CreativeJobKind = "product-cover-i2i";

  return {
    requestId: params.requestId,
    requestedByAgent: "creative-production",
    sellerId: params.sellerId ?? "default",
    channel,
    kind,
    objective: "conversion",
    budgetTier: "standard",
    references: params.referenceUrls.map((url) => ({
      type: "product-image" as const,
      uri: url,
    })),
    productContext: {
      title: params.productContext.title,
      ...(params.launchEnvelope ? { itemId: params.launchEnvelope.launchId } : {}),
    },
    ...(params.launchEnvelope ? { productLaunch: params.launchEnvelope } : {}),
    constraints: {
      preserveProductTruth: true,
      noBrandInfringement: true,
      requiresHumanApproval: true,
      channelFormat: {
        ml: {
          pictureType: "thumbnail",
          expectedCategoryId: "",
        },
      },
    },
  };
}
