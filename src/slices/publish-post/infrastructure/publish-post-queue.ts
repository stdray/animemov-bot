import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import path from "path";
import { PublishPostCommand } from "../domain/models";

type QueueStatus = "pending" | "processing";

type QueueRow = {
  id: number;
  requester_id: number;
  tweet_url: string;
  user_text: string;
  available_at: number;
  status: QueueStatus;
  retry_count: number;
  last_delay_ms: number;
};

export type QueueJob = {
  id: number;
  requesterId: number;
  tweetUrl: string;
  userText: string;
  availableAt: number;
  retryCount: number;
  lastDelayMs: number;
};

export class PublishPostQueue {
  readonly db: Database;
  readonly insertStmt;
  readonly reserveStmt;
  readonly markProcessingStmt;
  readonly nextAvailableStmt;
  readonly rescheduleStmt;
  readonly deleteStmt;
  readonly clearStmt;
  readonly statusStmt;
  readonly resetStmt;

  constructor(dbPath: string) {
    const directory = path.dirname(dbPath);
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }

    this.db = new Database(dbPath, { create: true });
    this.db.exec(`PRAGMA journal_mode = DELETE;`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS publish_post_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id INTEGER NOT NULL,
        tweet_url TEXT NOT NULL,
        user_text TEXT NOT NULL,
        status TEXT NOT NULL,
        available_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_delay_ms INTEGER NOT NULL DEFAULT 0
      );
    `);
    
    // Add new columns to existing tables if they don't exist
    try {
      this.db.exec(`ALTER TABLE publish_post_queue ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;`);
    } catch (e) {
      // Column already exists, ignore
    }
    try {
      this.db.exec(`ALTER TABLE publish_post_queue ADD COLUMN last_delay_ms INTEGER NOT NULL DEFAULT 0;`);
    } catch (e) {
      // Column already exists, ignore
    }
    
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_publish_post_queue_status_available ON publish_post_queue(status, available_at);`
    );

    this.resetStmt = this.db.prepare(
      `UPDATE publish_post_queue SET status='pending', available_at=?, updated_at=? WHERE status='processing'`
    );
    const now = Date.now();
    this.resetStmt.run(now, now);

    this.insertStmt = this.db.prepare(
      `INSERT INTO publish_post_queue (requester_id, tweet_url, user_text, status, available_at, created_at, updated_at, retry_count, last_delay_ms)
       VALUES ($requesterId, $tweetUrl, $userText, 'pending', $availableAt, $createdAt, $updatedAt, $retryCount, $lastDelayMs)`
    );

    this.reserveStmt = this.db.prepare(
      `SELECT id, requester_id, tweet_url, user_text, available_at, status, retry_count, last_delay_ms
       FROM publish_post_queue
       WHERE status='pending' AND available_at <= $now
       ORDER BY available_at ASC, id ASC
       LIMIT 1`
    );

    this.markProcessingStmt = this.db.prepare(
      `UPDATE publish_post_queue SET status='processing', updated_at=$updatedAt WHERE id=$id`
    );

    this.nextAvailableStmt = this.db.prepare(
      `SELECT available_at FROM publish_post_queue WHERE status='pending' ORDER BY available_at ASC, id ASC LIMIT 1`
    );

    this.rescheduleStmt = this.db.prepare(
      `UPDATE publish_post_queue 
       SET status='pending', available_at=$availableAt, updated_at=$updatedAt, retry_count=retry_count+1, last_delay_ms=$delayMs 
       WHERE id=$id`
    );

    this.deleteStmt = this.db.prepare(`DELETE FROM publish_post_queue WHERE id=$id`);
    this.clearStmt = this.db.prepare(`DELETE FROM publish_post_queue WHERE status IN ('pending', 'processing')`);
    this.statusStmt = this.db.prepare(`
      SELECT 
        status,
        COUNT(*) as count,
        MIN(available_at) as earliest_available,
        MAX(retry_count) as max_retries
      FROM publish_post_queue 
      WHERE status IN ('pending', 'processing')
      GROUP BY status
    `);
  }

  enqueue(command: PublishPostCommand, availableAt: number = Date.now(), retryCount: number = 0, lastDelayMs: number = 0) {
    const timestamp = Date.now();
    const result = this.insertStmt.run({
      $requesterId: command.requesterId,
      $tweetUrl: command.tweetUrl,
      $userText: command.userText,
      $availableAt: availableAt,
      $createdAt: timestamp,
      $updatedAt: timestamp,
      $retryCount: retryCount,
      $lastDelayMs: lastDelayMs
    });
    return Number(result.lastInsertRowid);
  }

  reserveNext(now: number): QueueJob | null {
    let row: QueueRow | undefined;
    const transaction = this.db.transaction(() => {
      row = this.reserveStmt.get({ $now: now }) as QueueRow | undefined;
      if (!row) {
        return;
      }
      this.markProcessingStmt.run({ $id: row.id, $updatedAt: Date.now() });
    });
    transaction();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      requesterId: row.requester_id,
      tweetUrl: row.tweet_url,
      userText: row.user_text,
      availableAt: row.available_at,
      retryCount: row.retry_count,
      lastDelayMs: row.last_delay_ms
    };
  }

  getNextAvailableAt() {
    const row = this.nextAvailableStmt.get() as { available_at: number } | undefined;
    return row ? Number(row.available_at) : null;
  }

  reschedule(id: number, retryAt: number, delayMs: number = 0) {
    // Update available_at and last_delay_ms
    this.rescheduleStmt.run({ $id: id, $availableAt: retryAt, $updatedAt: Date.now(), $delayMs: delayMs });
  }

  complete(id: number) {
    this.deleteStmt.run({ $id: id });
  }

  fail(id: number) {
    this.deleteStmt.run({ $id: id });
  }

  clearQueue() {
    const result = this.clearStmt.run();
    return result.changes;
  }

  getQueueStatus() {
    return this.statusStmt.all();
  }

  close() {
    this.insertStmt.finalize();
    this.reserveStmt.finalize();
    this.markProcessingStmt.finalize();
    this.nextAvailableStmt.finalize();
    this.rescheduleStmt.finalize();
    this.deleteStmt.finalize();
    this.clearStmt.finalize();
    this.statusStmt.finalize();
    this.resetStmt.finalize();
    this.db.close();
    try {
      unlinkSync(this.db.filename);
    } catch {}
  }
}
