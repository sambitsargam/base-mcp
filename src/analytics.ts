/**
 * Base MCP collects anonymous usage data to help us understand how the server is used
 * and to improve the product.
 */

import { version } from './version.js';

const ANALYTICS_URL = 'https://api.developer.coinbase.com/analytics';
const BATCH_SIZE = 20; // Increased batch size for better throughput
const BATCH_INTERVAL = 500; // Reduced interval for faster processing (ms)
const MAX_RETRIES = 3;
const RETRY_DELAY = 500; // Reduced retry delay (ms)
const MAX_QUEUE_SIZE = 1000; // Maximum queue size to prevent memory issues

export enum Event {
  CliInit = 'baseMcpCliInit',
  Initialized = 'baseMcpInitialized',
  ToolUsed = 'baseMcpToolSelected',
}

type EventData = {
  [Event.CliInit]: Record<string, never>;
  [Event.Initialized]: Record<string, never>;
  [Event.ToolUsed]: {
    toolName: string;
  };
};

type MetricEvent<E extends Event> = {
  eventType: E;
  sessionId?: string;
  data: EventData[E];
  timestamp: number;
};

// Event queue for batching with a circular buffer implementation
class CircularEventQueue {
  private queue: MetricEvent<Event>[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(event: MetricEvent<Event>) {
    if (this.queue.length >= this.maxSize) {
      // Remove oldest event if queue is full
      this.queue.shift();
    }
    this.queue.push(event);
  }

  splice(start: number, deleteCount: number): MetricEvent<Event>[] {
    return this.queue.splice(start, deleteCount);
  }

  get length(): number {
    return this.queue.length;
  }
}

const eventQueue = new CircularEventQueue(MAX_QUEUE_SIZE);
let batchTimeout: ReturnType<typeof setTimeout> | null = null;
let isProcessing = false;

async function retryWithBackoff(operation: () => Promise<Response>, retries = MAX_RETRIES): Promise<Response> {
  try {
    const response = await operation();
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return retryWithBackoff(operation, retries - 1);
    }
    throw error;
  }
}

async function sendBatch(events: MetricEvent<Event>[]) {
  if (events.length === 0) return;

  try {
    await retryWithBackoff(() =>
      fetch(ANALYTICS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'BaseMcp-Version': version,
          'Accept-Encoding': 'gzip', // Enable compression
        },
        body: JSON.stringify({
          events,
          batchSize: events.length,
          timestamp: Date.now(),
        }),
      })
    );
  } catch (error) {
    console.error('Failed to send analytics batch after retries:', error);
  } finally {
    isProcessing = false;
  }
}

async function processBatch() {
  if (isProcessing || eventQueue.length === 0) return;

  isProcessing = true;
  const batchSize = Math.min(BATCH_SIZE, eventQueue.length);
  const batch = eventQueue.splice(0, batchSize);
  
  // Process batch asynchronously
  sendBatch(batch).catch(() => {
    isProcessing = false;
  });

  // Schedule next batch if there are more events
  if (eventQueue.length > 0) {
    scheduleBatch();
  }
}

function scheduleBatch() {
  if (batchTimeout) {
    clearTimeout(batchTimeout);
  }

  batchTimeout = setTimeout(async () => {
    batchTimeout = null;
    await processBatch();
  }, BATCH_INTERVAL);
}

export function postMetric<E extends Event>(
  event: E,
  data: EventData[E],
  sessionId?: string,
) {
  const metricEvent: MetricEvent<E> = {
    eventType: event,
    sessionId,
    data,
    timestamp: Date.now(),
  };

  eventQueue.push(metricEvent);

  // Process immediately if we have enough events
  if (eventQueue.length >= BATCH_SIZE && !isProcessing) {
    processBatch();
  } else if (!batchTimeout && !isProcessing) {
    // Schedule a new batch if there isn't one already scheduled
    scheduleBatch();
  }
}

// Ensure any remaining events are sent before the process exits
process.on('beforeExit', async () => {
  if (eventQueue.length > 0) {
    await processBatch();
  }
});
