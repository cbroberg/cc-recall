import type { SearchOptions, SearchResult, EmbeddingProviderInterface } from './types.js';
import { RecallEmbeddingProvider } from './embeddings.js';
import { RecallStore, DEFAULT_DB_PATH } from './store.js';

export class RecallSearch {
  private store: RecallStore;
  private embedder: EmbeddingProviderInterface;

  constructor(store?: RecallStore, embedder?: EmbeddingProviderInterface) {
    this.store = store ?? new RecallStore(DEFAULT_DB_PATH);
    this.embedder = embedder ?? new RecallEmbeddingProvider();
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { vector } = await this.embedder.embed(query);
    return this.store.vectorSearch(vector, options);
  }
}
