import type { EmbeddingResult, EmbeddingProviderInterface } from './types.js';

const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_DIMENSIONS = 768;
const DEFAULT_BASE_URL = 'http://localhost:11434';

export class OllamaEmbeddingProvider implements EmbeddingProviderInterface {
  readonly dimensions: number;
  readonly modelName: string;
  private baseUrl: string;

  constructor(
    model: string = DEFAULT_MODEL,
    dimensions: number = DEFAULT_DIMENSIONS,
    baseUrl: string = DEFAULT_BASE_URL,
  ) {
    this.modelName = model;
    this.dimensions = dimensions;
    this.baseUrl = baseUrl;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.modelName, input: text }),
    });

    if (!res.ok) {
      throw new Error(`Ollama embed request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { embeddings: number[][] };
    return {
      vector: new Float32Array(data.embeddings[0]),
      dimensions: this.dimensions,
      model: this.modelName,
      provider: 'ollama',
    };
  }
}
