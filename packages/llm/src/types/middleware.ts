import type { Request } from './request.js';
import type { Response } from './response.js';
import type { StreamEvent } from './stream.js';

export type Middleware = (
  request: Request,
  next: (request: Request) => Promise<Response> | AsyncIterable<StreamEvent>,
) => Promise<Response> | AsyncIterable<StreamEvent>;
