import assert from 'node:assert/strict';
import test from 'node:test';

import worker from './index.mjs';

test('creates a short link and redirects through Redis REST storage', async () => {
    const commands = [];
    const storedValues = new Map();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url, init) => {
        assert.equal(url, 'https://redis-a.example');
        const command = JSON.parse(init.body);
        commands.push(command);

        if (command[0] === 'GET') {
            return Response.json({ result: storedValues.get(command[1]) || null });
        }

        if (command[0] === 'SET') {
            storedValues.set(command[1], command[2]);
            return Response.json({ result: 'OK' });
        }

        return Response.json({ error: 'unexpected command' }, { status: 400 });
    };

    try {
        const env = {
            APP_ORIGIN: 'https://uqtracker.vercel.app',
            REDIS_SHARDS_JSON: JSON.stringify([
                { id: 'redis-a', url: 'https://redis-a.example', token: 'token-a' }
            ])
        };
        const targetUrl = 'https://uqtracker.vercel.app/#encoded-plan-state';
        const createResponse = await worker.fetch(new Request('https://short.example/api/links', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ targetUrl })
        }), env);
        const createBody = await createResponse.json();

        assert.equal(createResponse.status, 201);
        assert.match(createBody.code, /^[0-9a-zA-Z]{8}$/);
        assert.equal(createBody.shortUrl, `https://short.example/${createBody.code}`);
        assert.deepEqual(commands[0][0], 'GET');
        assert.deepEqual(commands[1].slice(0, 4), ['SET', `uqtracker:short:${createBody.code}`, targetUrl, 'EX']);

        const redirectResponse = await worker.fetch(new Request(createBody.shortUrl), env);
        assert.equal(redirectResponse.status, 302);
        assert.equal(redirectResponse.headers.get('location'), targetUrl);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
