import { limits } from './limits.js';

export const attempts = () => limits.maxRetries + 1;
