import { Router } from 'express';

import { getPlatformSession } from '../lib/authSession.js';

export const authRouter = Router();

authRouter.get('/session', (_request, response) => {
  response.json(getPlatformSession());
});