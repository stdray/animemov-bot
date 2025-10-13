import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
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
};

export type QueueJob = {
  id: number;
  requesterId: number;
  tweetUrl: string;
  userText: string;
  availableAt: number;
};

export class PublishPostQueue {
  readonly db: Database;
  readonly insertStmt;
  readonly reserveStmt;
  readonly markProcessingStmt;
  readonly nextAvailableStmt;
  readonly rescheduleStmt;
  readonly deleteStmt;

  constructor(dbPath: string) {
    const directory = path.dirname(dbPath);
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }

    this.db = new Database(dbPath, { create: true });
    this.db.exec(`PRAGMA journal_mode = WAL;`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS publish_post_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id INTEGER NOT NULL,
        tweet_url TEXT NOT NULL,
        user_text TEXT NOT NULL,
        status TEXT NOT NULL,
        available_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_publish_post_queue_status_available ON publish_post_queue(status, available_at);`
    );

    const resetStmt = this.db.prepare(
      `UPDATE publish_post_queue SET status='pending', available_at=?, updated_at=? WHERE status='processing'`
    );
    const now = Date.now();
    resetStmt.run(now, now);

    this.insertStmt = this.db.prepare(
      `INSERT INTO publish_post_queue (requester_id, tweet_url, user_text, status, available_at, created_at, updated_at)
       VALUES ($requesterId, $tweetUrl, $userText, 'pending', $availableAt, $createdAt, $updatedAt)`
    );

    this.reserveStmt = this.db.prepare(
      `SELECT id, requester_id, tweet_url, user_text, available_at, status
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
      `UPDATE publish_post_queue SET status='pending', available_at=$availableAt, updated_at=$updatedAt WHERE id=$id`
    );

    this.deleteStmt = this.db.prepare(`DELETE FROM publish_post_queue WHERE id=$id`);
  }

  enqueue(command: PublishPostCommand, availableAt: number = Date.now()) {
    const timestamp = Date.now();
    const result = this.insertStmt.run({
      $requesterId: command.requesterId,
      $tweetUrl: command.tweetUrl,
      $userText: command.userText,
      $availableAt: availableAt,
      $createdAt: timestamp,
      $updatedAt: timestamp
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
      availableAt: row.available_at
    };
  }

  getNextAvailableAt() {
    const row = this.nextAvailableStmt.get() as { available_at: number } | undefined;
    return row ? Number(row.available_at) : null;
  }

  reschedule(id: number, retryAt: number) {
    this.rescheduleStmt.run({ $id: id, $availableAt: retryAt, $updatedAt: Date.now() });
  }

  complete(id: number) {
    this.deleteStmt.run({ $id: id });
  }

  fail(id: number) {
    this.deleteStmt.run({ $id: id });
  }
}
