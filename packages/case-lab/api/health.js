import { answer } from './_handler.js';

export default async function health(request, response) {
  await answer('/api/health', request, response, '');
}
