import type { AttemptEvidence, NoSubmissionProof } from "../../../domain/generationAttempt.js";
import type {
  CreativeAttemptEvidence,
  GenerationAttemptContext,
} from "../../../contracts/creative-requests.js";
import { MinimaxRequestError, type MinimaxClient } from "./minimax-client.js";

// ── Request / response types ──────────────────────────────────────────

export type MinimaxImageRequest = {
  model: string;
  prompt: string;
  aspect_ratio?: string | undefined;
  n?: number | undefined;
  response_format?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  subject_reference?: Array<{ type: string; image_file: string }> | undefined;
};

export type MinimaxImageResponse = {
  base_resp: { status_code: number; status_message: string };
  data: Array<{ image_url: string }>;
};

export type MinimaxVideoRequest = {
  model: string;
  prompt: string;
  duration: number;
  resolution?: string | undefined;
  first_frame_image?: string | undefined;
};

export type MinimaxVideoResponse = {
  base_resp: { status_code: number; status_message: string };
  task_id: string;
};

export type MinimaxVideoQueryResponse = {
  base_resp: { status_code: number; status_message: string };
  status: string;
  file_id?: string | undefined;
};

export type MinimaxFileRetrieveResponse = {
  base_resp: { status_code: number; status_message: string };
  file?: { download_url: string } | undefined;
};

// ── Transport type ────────────────────────────────────────────────────

export type MinimaxTransport = {
  validateTextModel(model?: string): Promise<{ valid: boolean; model: string }>;
  createImageTask(request: MinimaxImageRequest): Promise<MinimaxImageResponse>;
  createVideoTask(request: MinimaxVideoRequest): Promise<MinimaxVideoResponse>;
  queryVideoTask(taskId: string): Promise<MinimaxVideoQueryResponse>;
  retrieveFile(fileId: string): Promise<MinimaxFileRetrieveResponse>;
  submit?<T>(input: MinimaxSubmissionInput): Promise<MinimaxSubmissionResult<T>>;
};

export type MinimaxSubmissionInput = Readonly<{
  path: string;
  body: unknown;
  idempotencyKey: string;
  evidenceRef: string;
  recordedAt: string;
}>;

export type MinimaxSubmissionResult<T> =
  | Readonly<{
      kind: "accepted";
      response: T;
      providerRequestId: string | null;
      evidence: AttemptEvidence;
    }>
  | Readonly<{
      kind: "not-submitted" | "rejected";
      error: MinimaxRequestError;
      providerRequestId: string | null;
      evidence: AttemptEvidence;
      proof: NoSubmissionProof;
    }>
  | Readonly<{
      kind: "ambiguous";
      error: MinimaxRequestError;
      providerRequestId: string | null;
      evidence: AttemptEvidence;
    }>;

// ── Real transport (wraps MinimaxClient) ──────────────────────────────

export class MinimaxRealTransport implements MinimaxTransport {
  private readonly client: MinimaxClient;

  constructor(client: MinimaxClient) {
    this.client = client;
  }

  validateTextModel(model?: string): Promise<{ valid: boolean; model: string }> {
    const resolved = model ?? "MiniMax-M3";
    return Promise.resolve({ valid: true, model: resolved });
  }

  async submit<T>(input: MinimaxSubmissionInput): Promise<MinimaxSubmissionResult<T>> {
    try {
      const response = await this.client.post<T>(input.path, input.body, input.idempotencyKey);
      const providerRequestId = readProviderRequestId(response);
      return {
        kind: "accepted",
        response,
        providerRequestId,
        evidence: evidence(input, "submission", providerRequestId, "accepted"),
      };
    } catch (error) {
      const requestError =
        error instanceof MinimaxRequestError
          ? error
          : new MinimaxRequestError(
              "provider_error",
              error instanceof Error ? error.message : String(error),
            );
      const common = {
        error: requestError,
        providerRequestId: requestError.providerRequestId,
      };

      if (requestError.sendState === "definitely-unsent") {
        const proof: NoSubmissionProof = {
          kind: "transport-before-send",
          authority: "minimax-transport",
          bodyBytesOffered: 0,
          evidenceRef: input.evidenceRef,
        };
        return {
          kind: "not-submitted",
          ...common,
          evidence: evidence(input, "no-submission", null, requestError.sendState),
          proof,
        };
      }

      if (
        requestError.accepted === false &&
        requestError.charged === false &&
        requestError.providerRequestId
      ) {
        const proof: NoSubmissionProof = {
          kind: "provider-rejection",
          authority: "minimax-adapter",
          accepted: false,
          charged: false,
          providerRequestId: requestError.providerRequestId,
          evidenceRef: input.evidenceRef,
        };
        return {
          kind: "rejected",
          ...common,
          evidence: evidence(
            input,
            "no-submission",
            requestError.providerRequestId,
            "provider-rejection",
          ),
          proof,
        };
      }

      return {
        kind: "ambiguous",
        ...common,
        evidence: evidence(input, "error", requestError.providerRequestId, "possibly-sent"),
      };
    }
  }

  async createImageTask(request: MinimaxImageRequest): Promise<MinimaxImageResponse> {
    return this.client.post<MinimaxImageResponse>("/v1/image_generation", request);
  }

  async createVideoTask(request: MinimaxVideoRequest): Promise<MinimaxVideoResponse> {
    return this.client.post<MinimaxVideoResponse>("/v1/video_generation", request);
  }

  async queryVideoTask(taskId: string): Promise<MinimaxVideoQueryResponse> {
    return this.client.post<MinimaxVideoQueryResponse>("/v1/query/video_generation", {
      task_id: taskId,
    });
  }

  async retrieveFile(fileId: string): Promise<MinimaxFileRetrieveResponse> {
    return this.client.post<MinimaxFileRetrieveResponse>("/v1/files/retrieve", {
      file_id: fileId,
    });
  }
}

export class MinimaxAttemptTransport implements MinimaxTransport {
  attempt!: CreativeAttemptEvidence;
  failureReason?:
    "auth-error" | "rate-limited" | "insufficient-funds" | "content-rejected" | "provider-error";
  constructor(
    private readonly delegate: MinimaxTransport,
    private readonly context: GenerationAttemptContext,
  ) {}
  validateTextModel(model?: string) {
    return this.delegate.validateTextModel(model);
  }
  queryVideoTask(taskId: string) {
    return this.delegate.queryVideoTask(taskId);
  }
  retrieveFile(fileId: string) {
    return this.delegate.retrieveFile(fileId);
  }
  createImageTask(body: MinimaxImageRequest) {
    return this.submitTask<MinimaxImageResponse>("/v1/image_generation", body);
  }
  async createVideoTask(body: MinimaxVideoRequest) {
    const response = await this.submitTask<MinimaxVideoResponse>("/v1/video_generation", body);
    this.attempt = { ...this.attempt, taskId: response.task_id };
    return response;
  }
  private async submitTask<T>(path: string, body: unknown): Promise<T> {
    if (!this.delegate.submit) throw new Error("MiniMax durable submission transport is required");
    const result = await this.delegate.submit<T>({
      path,
      body,
      idempotencyKey: this.context.idempotencyKey,
      evidenceRef: `${this.context.attemptId}:submission`,
      recordedAt: new Date().toISOString(),
    });
    this.attempt = {
      ...this.context,
      taskId: null,
      providerRequestId: result.providerRequestId,
      outcome: result.kind === "accepted" ? "submitted" : result.kind,
      submission: result.evidence,
      ...(result.kind === "not-submitted" || result.kind === "rejected"
        ? { noSubmissionProof: result.proof }
        : {}),
    };
    if (result.kind === "accepted") return result.response;
    const category = result.error.category;
    this.failureReason =
      category === "auth_error"
        ? "auth-error"
        : category === "rate_limited"
          ? "rate-limited"
          : category === "insufficient_balance"
            ? "insufficient-funds"
            : category === "content_blocked"
              ? "content-rejected"
              : "provider-error";
    throw result.error;
  }
}

function evidence(
  input: MinimaxSubmissionInput,
  kind: AttemptEvidence["kind"],
  providerRequestId: string | null,
  sendState: string,
): AttemptEvidence {
  return {
    ref: input.evidenceRef,
    kind,
    payload: {
      idempotencyKey: input.idempotencyKey,
      providerRequestId,
      sendState,
    },
    recordedAt: input.recordedAt,
  };
}

function readProviderRequestId(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const record = response as Record<string, unknown>;
  const value = record["provider_request_id"] ?? record["request_id"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ── Fake transport (for unit tests) ───────────────────────────────────

const DEFAULT_FAKE_IMAGE_RESPONSE: MinimaxImageResponse = {
  base_resp: { status_code: 0, status_message: "success" },
  data: [{ image_url: "https://fake-cdn.minimax.io/img/001.jpg" }],
};

const DEFAULT_FAKE_VIDEO_RESPONSE: MinimaxVideoResponse = {
  base_resp: { status_code: 0, status_message: "success" },
  task_id: "fake-task-001",
};

const DEFAULT_FAKE_VIDEO_QUERY_RESPONSE: MinimaxVideoQueryResponse = {
  base_resp: { status_code: 0, status_message: "success" },
  status: "success",
  file_id: "fake-file-001",
};

const DEFAULT_FAKE_FILE_RETRIEVE_RESPONSE: MinimaxFileRetrieveResponse = {
  base_resp: { status_code: 0, status_message: "success" },
  file: { download_url: "https://fake-cdn.minimax.io/video/fake-file-001.mp4" },
};

export class MinimaxFakeTransport implements MinimaxTransport {
  private readonly imageResponse: MinimaxImageResponse;
  private readonly videoResponse: MinimaxVideoResponse;
  private readonly videoQueryResponse: MinimaxVideoQueryResponse;
  private readonly fileRetrieveResponse: MinimaxFileRetrieveResponse;
  private readonly modelOverride: string | undefined;

  constructor(overrides?: {
    imageResponse?: MinimaxImageResponse | undefined;
    videoResponse?: MinimaxVideoResponse | undefined;
    videoQueryResponse?: MinimaxVideoQueryResponse | undefined;
    fileRetrieveResponse?: MinimaxFileRetrieveResponse | undefined;
    modelOverride?: string | undefined;
  }) {
    this.imageResponse = overrides?.imageResponse ?? DEFAULT_FAKE_IMAGE_RESPONSE;
    this.videoResponse = overrides?.videoResponse ?? DEFAULT_FAKE_VIDEO_RESPONSE;
    this.videoQueryResponse = overrides?.videoQueryResponse ?? DEFAULT_FAKE_VIDEO_QUERY_RESPONSE;
    this.fileRetrieveResponse =
      overrides?.fileRetrieveResponse ?? DEFAULT_FAKE_FILE_RETRIEVE_RESPONSE;
    this.modelOverride = overrides?.modelOverride;
  }

  validateTextModel(model?: string): Promise<{ valid: boolean; model: string }> {
    const resolved = model ?? this.modelOverride ?? "MiniMax-M3";
    return Promise.resolve({ valid: true, model: resolved });
  }

  createImageTask(_request: MinimaxImageRequest): Promise<MinimaxImageResponse> {
    void _request;
    return Promise.resolve({ ...this.imageResponse });
  }

  createVideoTask(_request: MinimaxVideoRequest): Promise<MinimaxVideoResponse> {
    void _request;
    return Promise.resolve({ ...this.videoResponse });
  }

  queryVideoTask(_taskId: string): Promise<MinimaxVideoQueryResponse> {
    void _taskId;
    return Promise.resolve({ ...this.videoQueryResponse });
  }

  retrieveFile(_fileId: string): Promise<MinimaxFileRetrieveResponse> {
    void _fileId;
    return Promise.resolve({ ...this.fileRetrieveResponse });
  }
}

// ── Fixture transport (for integration tests) ─────────────────────────

const DEFAULT_FIXTURE_IMAGE_RESPONSE: MinimaxImageResponse = {
  base_resp: { status_code: 0, status_message: "success" },
  data: [{ image_url: "https://fixture-cdn.minimax.io/img/default.jpg" }],
};

const DEFAULT_FIXTURE_VIDEO_RESPONSE: MinimaxVideoResponse = {
  base_resp: { status_code: 0, status_message: "success" },
  task_id: "fixture-task-default",
};

const DEFAULT_FIXTURE_VIDEO_QUERY_RESPONSE: MinimaxVideoQueryResponse = {
  base_resp: { status_code: 0, status_message: "success" },
  status: "success",
  file_id: "fixture-file-default",
};

const DEFAULT_FIXTURE_FILE_RETRIEVE_RESPONSE: MinimaxFileRetrieveResponse = {
  base_resp: { status_code: 0, status_message: "success" },
  file: { download_url: "https://fixture-cdn.minimax.io/video/fixture-file-default.mp4" },
};

export class MinimaxFixtureTransport implements MinimaxTransport {
  private readonly imageFixtures: Record<string, MinimaxImageResponse>;
  private readonly videoFixtures: Record<string, MinimaxVideoResponse>;
  private readonly videoQueryFixtures: Record<string, MinimaxVideoQueryResponse>;
  private readonly fileRetrieveFixtures: Record<string, MinimaxFileRetrieveResponse>;

  constructor(fixtures?: {
    images?: Record<string, MinimaxImageResponse> | undefined;
    videos?: Record<string, MinimaxVideoResponse> | undefined;
    videoQueries?: Record<string, MinimaxVideoQueryResponse> | undefined;
    fileRetrieves?: Record<string, MinimaxFileRetrieveResponse> | undefined;
  }) {
    this.imageFixtures = fixtures?.images ?? {};
    this.videoFixtures = fixtures?.videos ?? {};
    this.videoQueryFixtures = fixtures?.videoQueries ?? {};
    this.fileRetrieveFixtures = fixtures?.fileRetrieves ?? {};
  }

  validateTextModel(model?: string): Promise<{ valid: boolean; model: string }> {
    const resolved = model ?? "MiniMax-M3";
    return Promise.resolve({ valid: true, model: resolved });
  }

  createImageTask(request: MinimaxImageRequest): Promise<MinimaxImageResponse> {
    const key = this.imageKey(request);
    const fixture = this.imageFixtures[key];
    return Promise.resolve(fixture ? { ...fixture } : { ...DEFAULT_FIXTURE_IMAGE_RESPONSE });
  }

  createVideoTask(request: MinimaxVideoRequest): Promise<MinimaxVideoResponse> {
    const key = this.videoKey(request);
    const fixture = this.videoFixtures[key];
    return Promise.resolve(fixture ? { ...fixture } : { ...DEFAULT_FIXTURE_VIDEO_RESPONSE });
  }

  queryVideoTask(taskId: string): Promise<MinimaxVideoQueryResponse> {
    const fixture = this.videoQueryFixtures[taskId];
    return Promise.resolve(fixture ? { ...fixture } : { ...DEFAULT_FIXTURE_VIDEO_QUERY_RESPONSE });
  }

  retrieveFile(fileId: string): Promise<MinimaxFileRetrieveResponse> {
    const fixture = this.fileRetrieveFixtures[fileId];
    return Promise.resolve(
      fixture ? { ...fixture } : { ...DEFAULT_FIXTURE_FILE_RETRIEVE_RESPONSE },
    );
  }

  private imageKey(request: MinimaxImageRequest): string {
    return `image:${request.model}:${request.prompt.slice(0, 50)}`;
  }

  private videoKey(request: MinimaxVideoRequest): string {
    return `video:${request.model}:${request.prompt.slice(0, 50)}`;
  }
}
