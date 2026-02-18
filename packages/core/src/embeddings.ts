import type { EmbeddingResult, EmbeddingProviderInterface } from './types.js';

export const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const DEFAULT_DIMENSIONS = 384;

type FeatureExtractionPipeline = (
  text: string,
  options?: Record<string, unknown>,
) => Promise<{ data: Float32Array | number[] }>;

export class RecallEmbeddingProvider implements EmbeddingProviderInterface {
  readonly dimensions: number;
  readonly modelName: string;
  private _pipeline: FeatureExtractionPipeline | null = null;

  constructor(model: string = DEFAULT_MODEL, dimensions: number = DEFAULT_DIMENSIONS) {
    this.modelName = model;
    this.dimensions = dimensions;
  }

  private async getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this._pipeline) {
      const { pipeline } = await import('@huggingface/transformers');
      this._pipeline = (await pipeline('feature-extraction', this.modelName, {
        dtype: 'fp32',
      })) as unknown as FeatureExtractionPipeline;
    }
    return this._pipeline;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const pipe = await this.getPipeline();
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    const vector = new Float32Array(output.data);
    return {
      vector,
      dimensions: this.dimensions,
      model: this.modelName,
      provider: 'local',
    };
  }
}
