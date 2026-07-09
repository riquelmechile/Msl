import OpenAI from "openai";

// ── Transport types ───────────────────────────────────────────────────

export type DeepSeekModel = {
  id: string;
  object: string;
  owned_by: string;
};

export type DeepSeekChatRequest = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean | undefined;
  tools?:
    | Array<{
        type: "function";
        function: { name: string; description: string; parameters: Record<string, unknown> };
      }>
    | undefined;
  tool_choice?: "auto" | "required" | { type: "function"; function: { name: string } } | undefined;
  extra_body?: Record<string, string> | undefined;
};

export type DeepSeekChatResponse = {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?:
        | Array<{
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          }>
        | undefined;
    };
    finish_reason: string;
  }>;
  usage?:
    | {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        prompt_tokens_details?: { cached_tokens?: number } | undefined;
      }
    | undefined;
};

export type DeepSeekStreamChunk = { delta: string; done: boolean };

// ── Transport type ─────────────────────────────────────────────────────

export type DeepSeekTransport = {
  listModels(): Promise<DeepSeekModel[]>;
  createChatCompletion(request: DeepSeekChatRequest): Promise<DeepSeekChatResponse>;
  streamChatCompletion(request: DeepSeekChatRequest): AsyncIterable<DeepSeekStreamChunk>;
};

// ── Real transport (wraps OpenAI SDK) ─────────────────────────────────

export class DeepSeekRealTransport implements DeepSeekTransport {
  private readonly client: OpenAI;

  constructor(apiKey: string, baseURL: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
      maxRetries: 3,
      timeout: 60000,
    });
  }

  async listModels(): Promise<DeepSeekModel[]> {
    const page = await this.client.models.list();
    return page.data.map((m) => ({
      id: m.id,
      object: m.object,
      owned_by: m.owned_by,
    }));
  }

  async createChatCompletion(request: DeepSeekChatRequest): Promise<DeepSeekChatResponse> {
    const completion = await this.client.chat.completions.create({
      model: request.model,
      messages: request.messages,
      stream: false,
      ...(request.tools ? { tools: request.tools } : {}),
      ...(request.tool_choice ? { tool_choice: request.tool_choice } : {}),
      ...(request.extra_body ? { extra_body: request.extra_body } : {}),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
    return this.normalizeResponse(completion);
  }

  async *streamChatCompletion(request: DeepSeekChatRequest): AsyncIterable<DeepSeekStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: request.model,
      messages: request.messages,
      stream: true,
      ...(request.tools ? { tools: request.tools } : {}),
      ...(request.tool_choice ? { tool_choice: request.tool_choice } : {}),
      ...(request.extra_body ? { extra_body: request.extra_body } : {}),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? "";
      const finishReason = chunk.choices[0]?.finish_reason;
      yield {
        delta: content,
        done: finishReason !== null && finishReason !== undefined,
      };
    }
  }

  private normalizeResponse(
    completion: OpenAI.Chat.Completions.ChatCompletion,
  ): DeepSeekChatResponse {
    return {
      id: completion.id,
      choices: completion.choices.map((c) => ({
        index: c.index,
        message: {
          role: c.message.role,
          content: c.message.content,
          tool_calls: c.message.tool_calls?.map((tc) => {
            if (tc.type === "function") {
              return {
                id: tc.id,
                type: "function" as const,
                function: { name: tc.function.name, arguments: tc.function.arguments },
              };
            }
            return {
              id: tc.id,
              type: "function" as const,
              function: { name: "", arguments: "{}" },
            };
          }),
        },
        finish_reason: c.finish_reason,
      })),
      usage: completion.usage
        ? {
            prompt_tokens: completion.usage.prompt_tokens,
            completion_tokens: completion.usage.completion_tokens,
            total_tokens: completion.usage.total_tokens,
            prompt_tokens_details:
              completion.usage.prompt_tokens_details &&
              completion.usage.prompt_tokens_details.cached_tokens !== undefined
                ? { cached_tokens: completion.usage.prompt_tokens_details.cached_tokens }
                : undefined,
          }
        : undefined,
    };
  }
}

// ── Fake transport (for unit tests) ───────────────────────────────────

const DEFAULT_FAKE_MODELS: DeepSeekModel[] = [
  { id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" },
  { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" },
];

const DEFAULT_FAKE_RESPONSE: DeepSeekChatResponse = {
  id: "fake-cmpl-001",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Fake response." },
      finish_reason: "stop",
    },
  ],
};

export class DeepSeekFakeTransport implements DeepSeekTransport {
  private readonly responses: DeepSeekChatResponse[];
  private nextIndex = 0;

  constructor(responses?: DeepSeekChatResponse[]) {
    this.responses = responses && responses.length > 0 ? responses : [DEFAULT_FAKE_RESPONSE];
  }

  listModels(): Promise<DeepSeekModel[]> {
    return Promise.resolve([...DEFAULT_FAKE_MODELS]);
  }

  createChatCompletion(_request: DeepSeekChatRequest): Promise<DeepSeekChatResponse> {
    void _request;
    const response = this.responses[this.nextIndex % this.responses.length];
    if (response === undefined) {
      return Promise.resolve(DEFAULT_FAKE_RESPONSE);
    }
    this.nextIndex = (this.nextIndex + 1) % this.responses.length;
    return Promise.resolve({ ...response });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async *streamChatCompletion(_request: DeepSeekChatRequest): AsyncIterable<DeepSeekStreamChunk> {
    void _request;
    const response = this.responses[this.nextIndex % this.responses.length];
    if (response === undefined) {
      yield { delta: "Fake response.", done: true };
      return;
    }
    const content = response.choices[0]?.message.content ?? "";
    yield { delta: content, done: true };
  }
}

// ── Fixture transport (for integration tests) ─────────────────────────

const DEFAULT_FIXTURE_RESPONSE: DeepSeekChatResponse = {
  id: "fixture-default-001",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Fixture default response." },
      finish_reason: "stop",
    },
  ],
};

export class DeepSeekFixtureTransport implements DeepSeekTransport {
  private readonly fixtures: Record<string, DeepSeekChatResponse>;

  constructor(fixtures: Record<string, DeepSeekChatResponse>) {
    this.fixtures = fixtures;
  }

  listModels(): Promise<DeepSeekModel[]> {
    return Promise.resolve([...DEFAULT_FAKE_MODELS]);
  }

  createChatCompletion(request: DeepSeekChatRequest): Promise<DeepSeekChatResponse> {
    const key = this.buildKey(request);
    const fixture = this.fixtures[key];
    return Promise.resolve(fixture ? { ...fixture } : { ...DEFAULT_FIXTURE_RESPONSE });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async *streamChatCompletion(request: DeepSeekChatRequest): AsyncIterable<DeepSeekStreamChunk> {
    const key = this.buildKey(request);
    const fixture = this.fixtures[key];
    const content = fixture?.choices[0]?.message.content ?? "Fixture default response.";
    yield { delta: content, done: true };
  }

  private buildKey(request: DeepSeekChatRequest): string {
    const firstContent = request.messages[0]?.content ?? "";
    return `${request.model}:${firstContent}`;
  }
}
