import type { MinimaxClient } from "./minimax-client.js";

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
};

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
