export type ChunkType =
  | 'decision'
  | 'code-change'
  | 'error-fix'
  | 'architecture'
  | 'conversation';

export type EmbeddingProvider = 'local' | 'ollama';

export interface EmbeddingResult {
  vector: Float32Array;
  dimensions: number;
  model: string;
  provider: EmbeddingProvider;
}

export interface EmbeddingProviderInterface {
  embed(text: string): Promise<EmbeddingResult>;
  readonly dimensions: number;
  readonly modelName: string;
}

export interface SessionChunk {
  id: string;
  sessionId: string;
  projectPath: string;
  type: ChunkType;
  content: string;
  summary: string;
  messageRange: {
    startIndex: number;
    endIndex: number;
    startTimestamp: string;
    endTimestamp: string;
  };
  metadata: {
    toolsUsed: string[];
    filesReferenced: string[];
    tags: string[];
  };
  embedding?: Float32Array;
  createdAt: Date;
}

export interface SessionMetadata {
  sessionId: string;
  projectPath: string;
  projectName: string;
  filePath: string;
  fileSize: number;
  fileHash: string;
  messageCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
  chunkCount: number;
  indexedAt: Date;
}

export interface SearchResult {
  chunk: SessionChunk;
  score: number;
  session: SessionMetadata;
}

export interface SearchOptions {
  project?: string;
  chunkType?: ChunkType;
  limit?: number;
}

export interface IndexOptions {
  sessionsPath?: string;
  dbPath?: string;
  embeddingModel?: string;
  ollamaUrl?: string;
  watchMode?: boolean;
}

// --- Internal parser types ---

export interface RawEntry {
  type: 'user' | 'assistant' | string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
  timestamp?: string;
  uuid?: string;
  parentUuid?: string;
  isSidechain?: boolean;
  sessionId?: string;
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | string;
  // text blocks
  text?: string;
  // tool_use blocks (assistant)
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result blocks (user)
  tool_use_id?: string;
  content?: string | ContentBlock[];
}

export interface IndexedEntry extends RawEntry {
  index: number;
}

export interface ParsedSession {
  sessionId: string;
  projectPath: string;
  filePath: string;
  entries: IndexedEntry[];
  firstTimestamp: string;
  lastTimestamp: string;
  messageCount: number;
}
