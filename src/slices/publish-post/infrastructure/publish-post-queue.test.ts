import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { PublishPostQueue } from "./publish-post-queue";
import { PublishPostCommand } from "../domain/models";
import { existsSync, unlinkSync } from "fs";
import path from "path";

describe("PublishPostQueue - Message Priority", () => {
  let queue: PublishPostQueue;
  let testDbPath: string;

  beforeEach(() => {
    // Create a unique test database for each test
    testDbPath = path.resolve(`test-queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.sqlite`);
    queue = new PublishPostQueue(testDbPath);
  });

  afterEach(() => {
    // Clean up test database
    queue.db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  test("delayed message should be processed before other Twitter messages but after immediate messages", async () => {
    const now = Date.now();
    
    // Create test commands
    const immediateCommand: PublishPostCommand = {
      requesterId: 1,
      tweetUrl: "https://twitter.com/user/status/1",
      userText: "Immediate message"
    };
    
    const delayedCommand: PublishPostCommand = {
      requesterId: 2, 
      tweetUrl: "https://twitter.com/user/status/2",
      userText: "Delayed message"
    };
    
    const futureCommand: PublishPostCommand = {
      requesterId: 3,
      tweetUrl: "https://twitter.com/user/status/3", 
      userText: "Future message"
    };

    // Enqueue messages with different timing
    // 1. Future message (should be processed last)
    const futureJobId = queue.enqueue(futureCommand, now + 10000); // 10 seconds in future
    
    // 2. Delayed message (should be processed second - in 5 seconds)
    const delayedJobId = queue.enqueue(delayedCommand, now + 5000); // 5 seconds in future
    
    // 3. Immediate message (should be processed first)
    const immediateJobId = queue.enqueue(immediateCommand, now); // Process immediately

    // Verify processing order
    
    // First job should be immediate
    const firstJob = queue.reserveNext(now);
    expect(firstJob).not.toBeNull();
    expect(firstJob!.id).toBe(immediateJobId);
    expect(firstJob!.userText).toBe("Immediate message");
    queue.complete(firstJob!.id);

    // Second job should be delayed message (when time comes)
    const secondJob = queue.reserveNext(now + 5000);
    expect(secondJob).not.toBeNull();
    expect(secondJob!.id).toBe(delayedJobId);
    expect(secondJob!.userText).toBe("Delayed message");
    queue.complete(secondJob!.id);

    // Third job should be future message (when time comes)
    const thirdJob = queue.reserveNext(now + 10000);
    expect(thirdJob).not.toBeNull();
    expect(thirdJob!.id).toBe(futureJobId);
    expect(thirdJob!.userText).toBe("Future message");
    queue.complete(thirdJob!.id);

    // No more jobs
    const noMoreJobs = queue.reserveNext(now + 15000);
    expect(noMoreJobs).toBeNull();
  });

  test("messages with same timing should be processed in order of insertion", async () => {
    const now = Date.now();
    
    const command1: PublishPostCommand = {
      requesterId: 1,
      tweetUrl: "https://twitter.com/user/status/1",
      userText: "First message"
    };
    
    const command2: PublishPostCommand = {
      requesterId: 2,
      tweetUrl: "https://twitter.com/user/status/2", 
      userText: "Second message"
    };
    
    const command3: PublishPostCommand = {
      requesterId: 3,
      tweetUrl: "https://twitter.com/user/status/3",
      userText: "Third message"
    };

    // Enqueue all with same timing
    const jobId1 = queue.enqueue(command1, now);
    const jobId2 = queue.enqueue(command2, now);
    const jobId3 = queue.enqueue(command3, now);

    // Should be processed in order of insertion (FIFO)
    const job1 = queue.reserveNext(now);
    expect(job1!.id).toBe(jobId1);
    expect(job1!.userText).toBe("First message");
    queue.complete(job1!.id);

    const job2 = queue.reserveNext(now);
    expect(job2!.id).toBe(jobId2); 
    expect(job2!.userText).toBe("Second message");
    queue.complete(job2!.id);

    const job3 = queue.reserveNext(now);
    expect(job3!.id).toBe(jobId3);
    expect(job3!.userText).toBe("Third message");
    queue.complete(job3!.id);
  });

  test("rescheduled message should maintain delay tracking", async () => {
    const now = Date.now();
    
    const command: PublishPostCommand = {
      requesterId: 1,
      tweetUrl: "https://twitter.com/user/status/1",
      userText: "Rescheduled message"
    };

    // Initial enqueue
    const jobId = queue.enqueue(command, now);
    
    // Reserve and reschedule with delay
    const job = queue.reserveNext(now);
    expect(job).not.toBeNull();
    expect(job!.retryCount).toBe(0);
    expect(job!.lastDelayMs).toBe(0);
    
    const delayMs = 5000;
    const retryAt = now + delayMs;
    queue.reschedule(job!.id, retryAt, delayMs);

    // Reserve again after delay
    const rescheduledJob = queue.reserveNext(retryAt);
    expect(rescheduledJob).not.toBeNull();
    expect(rescheduledJob!.id).toBe(jobId);
    expect(rescheduledJob!.retryCount).toBe(1); // Should be incremented
    expect(rescheduledJob!.lastDelayMs).toBe(delayMs); // Should track delay
  });

  test("queue status should show correct information", async () => {
    const now = Date.now();
    
    // Add some jobs
    const command1: PublishPostCommand = {
      requesterId: 1,
      tweetUrl: "https://twitter.com/user/status/1", 
      userText: "Pending message 1"
    };
    
    const command2: PublishPostCommand = {
      requesterId: 2,
      tweetUrl: "https://twitter.com/user/status/2",
      userText: "Pending message 2"
    };

    queue.enqueue(command1, now);
    queue.enqueue(command2, now + 5000);
    
    // Reserve one job (makes it processing)
    const job = queue.reserveNext(now);
    expect(job).not.toBeNull();

    // Check queue status
    const status = queue.getQueueStatus();
    
    // Should have both pending and processing jobs
    const pendingStatus = status.find(s => s.status === 'pending');
    const processingStatus = status.find(s => s.status === 'processing');
    
    expect(pendingStatus).toBeDefined();
    expect(pendingStatus!.count).toBe(1);
    
    expect(processingStatus).toBeDefined();
    expect(processingStatus!.count).toBe(1);
  });

  test("clear queue should remove all pending and processing jobs", async () => {
    const now = Date.now();
    
    // Add multiple jobs
    const command1: PublishPostCommand = {
      requesterId: 1,
      tweetUrl: "https://twitter.com/user/status/1",
      userText: "Message 1"
    };
    
    const command2: PublishPostCommand = {
      requesterId: 2,
      tweetUrl: "https://twitter.com/user/status/2", 
      userText: "Message 2"
    };
    
    const command3: PublishPostCommand = {
      requesterId: 3,
      tweetUrl: "https://twitter.com/user/status/3",
      userText: "Message 3"
    };

    queue.enqueue(command1, now);
    queue.enqueue(command2, now);
    queue.enqueue(command3, now);
    
    // Reserve one job to make it processing
    const job = queue.reserveNext(now);
    expect(job).not.toBeNull();

    // Clear queue
    const clearedCount = queue.clearQueue();
    expect(clearedCount).toBe(3); // Should clear all jobs including processing one

    // Verify queue is empty
    const statusAfter = queue.getQueueStatus();
    expect(statusAfter).toHaveLength(0);
    
    const nextJob = queue.reserveNext(now);
    expect(nextJob).toBeNull();
  });
});