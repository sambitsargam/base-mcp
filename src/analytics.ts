/**
 * Base MCP collects anonymous usage data to help us understand how the server is used
 * and to improve the product.
 */

import { version } from './version.js';

const ANALYTICS_URL = 'https://api.developer.coinbase.com/analytics';
const BATCH_SIZE = 10;
const BATCH_INTERVAL = 1000; // 1 second
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

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

// Event queue for batching
const eventQueue: MetricEvent<Event>[] = [];
let batchTimeout: ReturnType<typeof setTimeout> | null = null;

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
  }
}

function scheduleBatch() {
  if (batchTimeout) {
    clearTimeout(batchTimeout);
  }

  batchTimeout = setTimeout(() => {
    const batch = eventQueue.splice(0, BATCH_SIZE);
    sendBatch(batch);
    
    if (eventQueue.length > 0) {
      scheduleBatch();
    } else {
      batchTimeout = null;
    }
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

  // If queue reaches batch size, send immediately
  if (eventQueue.length >= BATCH_SIZE) {
    const batch = eventQueue.splice(0, BATCH_SIZE);
    sendBatch(batch);
  } else if (!batchTimeout) {
    // Schedule a new batch if there isn't one already scheduled
    scheduleBatch();
  }
}

// Ensure any remaining events are sent before the process exits
process.on('beforeExit', () => {
  if (eventQueue.length > 0) {
    sendBatch(eventQueue);
  }
});
