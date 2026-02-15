import { NextRequest, NextResponse } from 'next/server';
import { getLatestBoardEventId, listBoardEventsAfter } from '../../../../../lib/server/board';
import { getRedisClient } from '../../../../../lib/server/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sseFrame = (params: { id?: string; event?: string; data: string }) => {
  const lines: string[] = [];
  if (params.id) {
    lines.push(`id: ${params.id}`);
  }
  if (params.event) {
    lines.push(`event: ${params.event}`);
  }
  lines.push(`data: ${params.data}`);
  return `${lines.join('\n')}\n\n`;
};

export async function GET(request: NextRequest) {
  const redis = await getRedisClient();
  if (!redis) {
    return NextResponse.json({ error: 'Redis stream unavailable' }, { status: 503 });
  }

  const url = new URL(request.url);
  const lastFromQuery = url.searchParams.get('lastEventId') || '';
  const lastFromHeader = request.headers.get('last-event-id') || '';
  const requestedLast = (lastFromQuery || lastFromHeader || '').trim();

  const encoder = new TextEncoder();

  let closed = false;
  let cursor = requestedLast && requestedLast !== '$' ? requestedLast : await getLatestBoardEventId();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (payload: string) => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(payload));
      };

      push('retry: 2000\n\n');
      push(
        sseFrame({
          event: 'ready',
          data: JSON.stringify({ serverTime: new Date().toISOString(), cursor }),
        }),
      );

      const heartbeat = setInterval(() => {
        push(
          sseFrame({
            event: 'ping',
            data: JSON.stringify({ serverTime: new Date().toISOString() }),
          }),
        );
      }, 15_000);

      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // noop
        }
      };

      request.signal.addEventListener('abort', close);

      const runLoop = async () => {
        while (!closed) {
          const events = await listBoardEventsAfter(cursor, 64);
          if (!events.length) {
            await sleep(1200);
            continue;
          }

          for (const event of events) {
            if (closed) {
              break;
            }

            cursor = event.id;
            push(
              sseFrame({
                id: event.id,
                event: event.type,
                data: JSON.stringify(event),
              }),
            );
          }
        }
      };

      void runLoop().catch((error) => {
        console.error('[board/stream] loop failed', error);
        close();
      });
    },
    cancel() {
      closed = true;
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
