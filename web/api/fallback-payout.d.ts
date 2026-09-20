import type { IncomingMessage, ServerResponse } from 'node:http';

declare function handler(
  req: IncomingMessage & { body?: unknown; method?: string },
  res: ServerResponse & { status: (c: number) => unknown; json: (o: unknown) => unknown },
): Promise<unknown>;

export default handler;
