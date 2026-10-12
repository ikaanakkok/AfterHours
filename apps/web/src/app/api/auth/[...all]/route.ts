import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@afterhours/core/auth';

export const runtime = 'nodejs';
export const { GET, POST } = toNextJsHandler(auth);
