import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import type { SessionChunk, SessionMetadata, SearchResult, SearchOptions, ChunkType } from './types.js';

export const DEFAULT_DB_PATH = `${homedir()}/.cc-recall/recall.db`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  project_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_hash TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  first_timestamp TEXT NOT NULL DEFAULT '',
  last_timestamp TEXT NOT NULL DEFAULT '',
  chunk_count INTEGER DEFAULT 0,
  indexed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON sessions(last_timestamp DESC);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('decision', 'code-change', 'error-fix', 'architecture', 'conversation')),
  content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  start_index INTEGER NOT NULL,
  end_index INTEGER NOT NULL,
  start_timestamp TEXT NOT NULL DEFAULT '',
  end_timestamp TEXT NOT NULL DEFAULT '',
  tools_used TEXT NOT NULL DEFAULT '[]',
  files_referenced TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id);
CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(type);
`;

interface RawSessionRow {
  id: string;
  project_path: string;
  project_name: string;
  file_path: string;
  file_size: number;
  file_hash: string;
  message_count: number;
  first_timestamp: string;
  last_timestamp: string;
  chunk_count: number;
  indexed_at: number;
}

interface RawChunkRow {
  id: string;
  session_id: string;
  type: string;
  content: string;
  summary: string;
  start_index: number;
  end_index: number;
  start_timestamp: string;
  end_timestamp: string;
  tools_used: string;
  files_referenced: string;
  tags: string;
  created_at: number;
}

interface RawSearchRow extends RawChunkRow {
  project_path: string;
  project_name: string;
  file_path: string;
  file_size: number;
  file_hash: string;
  message_count: number;
  s_first_ts: string;
  s_last_ts: string;
  chunk_count: number;
  indexed_at: number;
  distance: number;
}

function mapSessionRow(row: RawSessionRow): SessionMetadata {
  return {
    sessionId: row.id,
    projectPath: row.project_path,
    projectName: row.project_name,
    filePath: row.file_path,
    fileSize: row.file_size,
    fileHash: row.file_hash,
    messageCount: row.message_count,
    firstTimestamp: row.first_timestamp,
    lastTimestamp: row.last_timestamp,
    chunkCount: row.chunk_count,
    indexedAt: new Date(row.indexed_at * 1000),
  };
}

function mapChunkRow(row: RawChunkRow, projectPath = ''): SessionChunk {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectPath,
    type: row.type as ChunkType,
    content: row.content,
    summary: row.summary,
    messageRange: {
      startIndex: row.start_index,
      endIndex: row.end_index,
      startTimestamp: row.start_timestamp,
      endTimestamp: row.end_timestamp,
    },
    metadata: {
      toolsUsed: JSON.parse(row.tools_used) as string[],
      filesReferenced: JSON.parse(row.files_referenced) as string[],
      tags: JSON.parse(row.tags) as string[],
    },
    createdAt: new Date(row.created_at * 1000),
  };
}

export class RecallStore {
  private db: Database.Database;
  private dimensions: number;

  constructor(dbPath: string = DEFAULT_DB_PATH, dimensions = 384) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.dimensions = dimensions;

    sqliteVec.load(this.db);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(SCHEMA);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding FLOAT[${this.dimensions}]
      )
    `);
  }

  hasSession(sessionId: string): boolean {
    const row = this.db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    return !!row;
  }

  getSessionHash(sessionId: string): string | null {
    const row = this.db
      .prepare('SELECT file_hash FROM sessions WHERE id = ?')
      .get(sessionId) as { file_hash: string } | undefined;
    return row?.file_hash ?? null;
  }

  upsertSession(meta: SessionMetadata): void {
    this.db
      .prepare(`
        INSERT INTO sessions
          (id, project_path, project_name, file_path, file_size, file_hash,
           message_count, first_timestamp, last_timestamp, chunk_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          file_size = excluded.file_size,
          file_hash = excluded.file_hash,
          message_count = excluded.message_count,
          first_timestamp = excluded.first_timestamp,
          last_timestamp = excluded.last_timestamp,
          chunk_count = excluded.chunk_count,
          updated_at = unixepoch()
      `)
      .run(
        meta.sessionId,
        meta.projectPath,
        meta.projectName,
        meta.filePath,
        meta.fileSize,
        meta.fileHash,
        meta.messageCount,
        meta.firstTimestamp,
        meta.lastTimestamp,
        meta.chunkCount,
      );
  }

  deleteSessionChunks(sessionId: string): void {
    const chunkIds = this.db
      .prepare('SELECT id FROM chunks WHERE session_id = ?')
      .all(sessionId) as { id: string }[];

    const deleteVec = this.db.prepare('DELETE FROM chunks_vec WHERE chunk_id = ?');
    const deleteChunks = this.db.prepare('DELETE FROM chunks WHERE session_id = ?');

    const tx = this.db.transaction(() => {
      for (const { id } of chunkIds) deleteVec.run(id);
      deleteChunks.run(sessionId);
    });
    tx();
  }

  insertChunks(chunks: SessionChunk[]): void {
    const insertChunk = this.db.prepare(`
      INSERT OR REPLACE INTO chunks
        (id, session_id, type, content, summary, start_index, end_index,
         start_timestamp, end_timestamp, tools_used, files_referenced, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertVec = this.db.prepare(
      'INSERT OR REPLACE INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)',
    );

    const tx = this.db.transaction((list: SessionChunk[]) => {
      for (const chunk of list) {
        insertChunk.run(
          chunk.id,
          chunk.sessionId,
          chunk.type,
          chunk.content,
          chunk.summary,
          chunk.messageRange.startIndex,
          chunk.messageRange.endIndex,
          chunk.messageRange.startTimestamp,
          chunk.messageRange.endTimestamp,
          JSON.stringify(chunk.metadata.toolsUsed),
          JSON.stringify(chunk.metadata.filesReferenced),
          JSON.stringify(chunk.metadata.tags),
        );
        if (chunk.embedding) {
          insertVec.run(chunk.id, new Uint8Array(chunk.embedding.buffer));
        }
      }
    });

    tx(chunks);
  }

  vectorSearch(queryVector: Float32Array, options: SearchOptions = {}): SearchResult[] {
    const limit = options.limit ?? 5;

    let sql = `
      SELECT
        c.id, c.session_id, c.type, c.content, c.summary,
        c.start_index, c.end_index, c.start_timestamp, c.end_timestamp,
        c.tools_used, c.files_referenced, c.tags, c.created_at,
        s.project_path, s.project_name, s.file_path, s.file_size, s.file_hash,
        s.message_count, s.first_timestamp AS s_first_ts, s.last_timestamp AS s_last_ts,
        s.chunk_count, s.indexed_at, v.distance
      FROM chunks_vec v
      JOIN chunks c ON c.id = v.chunk_id
      JOIN sessions s ON s.id = c.session_id
      WHERE v.embedding MATCH ? AND k = ?
      ORDER BY v.distance
    `;

    const params: unknown[] = [new Uint8Array(queryVector.buffer), limit];

    if (options.chunkType) {
      sql += ' AND c.type = ?';
      params.push(options.chunkType);
    }

    if (options.project) {
      sql += ' AND (s.project_name = ? OR s.project_path LIKE ?)';
      params.push(options.project, `%${options.project}%`);
    }

    sql += ' LIMIT ?';
    params.push(limit); // belt-and-suspenders after k= filter

    const rows = this.db.prepare(sql).all(...(params as Parameters<Database.Statement['all']>)) as RawSearchRow[];

    return rows.map((row) => ({
      chunk: {
        id: row.id,
        sessionId: row.session_id,
        projectPath: row.project_path,
        type: row.type as ChunkType,
        content: row.content,
        summary: row.summary,
        messageRange: {
          startIndex: row.start_index,
          endIndex: row.end_index,
          startTimestamp: row.start_timestamp,
          endTimestamp: row.end_timestamp,
        },
        metadata: {
          toolsUsed: JSON.parse(row.tools_used) as string[],
          filesReferenced: JSON.parse(row.files_referenced) as string[],
          tags: JSON.parse(row.tags) as string[],
        },
        createdAt: new Date(row.created_at * 1000),
      },
      score: 1 - row.distance / 2, // cosine distance [0,2] → similarity [0,1]
      session: {
        sessionId: row.session_id,
        projectPath: row.project_path,
        projectName: row.project_name,
        filePath: row.file_path,
        fileSize: row.file_size,
        fileHash: row.file_hash,
        messageCount: row.message_count,
        firstTimestamp: row.s_first_ts,
        lastTimestamp: row.s_last_ts,
        chunkCount: row.chunk_count,
        indexedAt: new Date(row.indexed_at * 1000),
      },
    }));
  }

  getSession(sessionId: string): SessionMetadata | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as RawSessionRow | undefined;
    return row ? mapSessionRow(row) : null;
  }

  getAllSessions(projectName?: string): SessionMetadata[] {
    if (projectName) {
      return (
        this.db
          .prepare(
            'SELECT * FROM sessions WHERE project_name = ? OR project_path LIKE ? ORDER BY last_timestamp DESC',
          )
          .all(projectName, `%${projectName}%`) as RawSessionRow[]
      ).map(mapSessionRow);
    }
    return (
      this.db.prepare('SELECT * FROM sessions ORDER BY last_timestamp DESC').all() as RawSessionRow[]
    ).map(mapSessionRow);
  }

  getChunksBySession(sessionId: string): SessionChunk[] {
    const session = this.getSession(sessionId);
    const rows = this.db
      .prepare('SELECT * FROM chunks WHERE session_id = ? ORDER BY start_index')
      .all(sessionId) as RawChunkRow[];
    return rows.map((row) => mapChunkRow(row, session?.projectPath ?? ''));
  }

  getDecisions(projectName?: string, limit = 20): SessionChunk[] {
    if (projectName) {
      return (
        this.db
          .prepare(`
            SELECT c.* FROM chunks c
            JOIN sessions s ON s.id = c.session_id
            WHERE c.type = 'decision'
              AND (s.project_name = ? OR s.project_path LIKE ?)
            ORDER BY c.created_at DESC LIMIT ?
          `)
          .all(projectName, `%${projectName}%`, limit) as RawChunkRow[]
      ).map((row) => mapChunkRow(row));
    }
    return (
      this.db
        .prepare("SELECT * FROM chunks WHERE type = 'decision' ORDER BY created_at DESC LIMIT ?")
        .all(limit) as RawChunkRow[]
    ).map((row) => mapChunkRow(row));
  }

  close(): void {
    this.db.close();
  }
}
