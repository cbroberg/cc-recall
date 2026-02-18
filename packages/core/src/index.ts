export { RecallIndexer, DEFAULT_SESSIONS_PATH } from './indexer.js';
export { RecallSearch } from './search.js';
export { RecallEmbeddingProvider, DEFAULT_MODEL, DEFAULT_DIMENSIONS } from './embeddings.js';
export { OllamaEmbeddingProvider } from './embeddings-ollama.js';
export { RecallStore, DEFAULT_DB_PATH } from './store.js';
export { SessionWatcher } from './watcher.js';
export { redactSecrets } from './redact.js';
export { parseSessionFile, extractText, extractToolNames, extractFilePaths } from './parser.js';
export { chunkSession } from './chunker.js';

export type {
  SessionChunk,
  SessionMetadata,
  ChunkType,
  SearchResult,
  SearchOptions,
  IndexOptions,
  EmbeddingResult,
  EmbeddingProviderInterface,
  ParsedSession,
} from './types.js';
