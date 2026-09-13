import { answer, send } from './_handler.js';

const MAX_BODY_BYTES = 1_024;

class BodyTooLarge extends Error {}

function bounded(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new BodyTooLarge('body exceeds 1 KiB');
  return text;
}

/** Vercel may hand over a pre-parsed body; every branch is bounded before the handler sees it. */
function readBody(request) {
  if (typeof request.body === 'string') return Promise.resolve(bounded(request.body));
  if (request.body !== undefined && request.body !== null && typeof request.body === 'object') {
    return Promise.resolve(bounded(JSON.stringify(request.body)));
  }
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new BodyTooLarge('body exceeds 1 KiB'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

export default async function dispatch(request, response) {
  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    const tooLarge = error instanceof BodyTooLarge;
    send(response, {
      status: tooLarge ? 413 : 400,
      headers: { 'Cache-Control': 'no-store' },
      body: { error: tooLarge ? 'request exceeds 1 KiB' : 'request body could not be read' },
    });
    return;
  }
  await answer('/api/dispatch', request, response, body);
}
