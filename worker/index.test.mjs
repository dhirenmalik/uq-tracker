import assert from 'node:assert/strict';
import test from 'node:test';

import worker from './index.mjs';
import { ConsistentHashRing } from './consistentHash.mjs';

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
            APP_ORIGIN: 'https://uq-tracker.vercel.app',
            REDIS_SHARDS_JSON: JSON.stringify([
                { id: 'redis-a', url: 'https://redis-a.example', token: 'token-a' }
            ])
        };
        const targetUrl = 'https://uq-tracker.vercel.app/#encoded-plan-state';
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

test('recovers and lazily migrates a link remapped after adding a Redis shard', async () => {
    const nodeIdsBefore = ['redis-a', 'redis-b', 'redis-c', 'redis-d'];
    const nodeIdsAfter = [...nodeIdsBefore, 'redis-e'];
    const beforeRing = new ConsistentHashRing(nodeIdsBefore);
    const afterRing = new ConsistentHashRing(nodeIdsAfter);
    let code = '';
    for (let index = 0; index < 10000; index++) {
        const candidate = `code${index.toString(36).padStart(4, '0')}`;
        if (beforeRing.getNode(candidate).id !== afterRing.getNode(candidate).id) {
            code = candidate;
            break;
        }
    }
    assert.ok(code, 'expected at least one key to move after adding a shard');

    const stores = new Map(nodeIdsAfter.map(id => [id, new Map()]));
    const oldOwner = beforeRing.getNode(code).id;
    const newOwner = afterRing.getNode(code).id;
    const targetUrl = 'https://uq-tracker.vercel.app/#migrated-plan-state';
    const key = `uqtracker:short:${code}`;
    stores.get(oldOwner).set(key, targetUrl);
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url, init) => {
        const id = new URL(url).hostname.split('.')[0];
        const command = JSON.parse(init.body);
        const store = stores.get(id);
        if (command[0] === 'GET') return Response.json({ result: store.get(command[1]) || null });
        if (command[0] === 'SET') {
            store.set(command[1], command[2]);
            return Response.json({ result: 'OK' });
        }
        return Response.json({ error: 'unexpected command' }, { status: 400 });
    };

    try {
        const env = {
            APP_ORIGIN: 'https://uq-tracker.vercel.app',
            REDIS_SHARDS_JSON: JSON.stringify(nodeIdsAfter.map(id => ({
                id,
                url: `https://${id}.example`,
                token: `${id}-token`
            })))
        };
        const response = await worker.fetch(new Request(`https://short.example/${code}`), env);

        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), targetUrl);
        assert.notEqual(oldOwner, newOwner);
        assert.equal(stores.get(newOwner).get(key), targetUrl);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
