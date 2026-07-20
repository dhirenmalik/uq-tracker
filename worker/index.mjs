import { ConsistentHashRing, DEFAULT_VIRTUAL_NODES } from './consistentHash.mjs';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 180;
const CODE_LENGTH = 8;
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const routerCache = new WeakMap();

function jsonResponse(body, init = {}) {
    return new Response(JSON.stringify(body), {
        ...init,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            ...corsHeaders(init.headers)
        }
    });
}

function corsHeaders(headers = {}) {
    return {
        'access-control-allow-origin': headers['access-control-allow-origin'] || '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type,authorization',
        ...headers
    };
}

function getAppOrigin(env) {
    return String(env.APP_ORIGIN || 'https://uq-tracker.vercel.app').replace(/\/$/, '');
}

function parseShardConfig(env) {
    if (env.REDIS_SHARDS_JSON) {
        const parsed = JSON.parse(env.REDIS_SHARDS_JSON);
        if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error('REDIS_SHARDS_JSON must be a non-empty array');
        }
        return parsed.map((shard, index) => ({
            id: shard.id || `redis-${index}`,
            url: String(shard.url || '').replace(/\/$/, ''),
            token: shard.token
        })).map(validateShard);
    }

    if (env.REDIS_REST_URL && env.REDIS_REST_TOKEN) {
        return [validateShard({
            id: 'redis-primary',
            url: String(env.REDIS_REST_URL).replace(/\/$/, ''),
            token: env.REDIS_REST_TOKEN
        })];
    }

    throw new Error('Configure REDIS_SHARDS_JSON or REDIS_REST_URL/REDIS_REST_TOKEN');
}

function validateShard(shard) {
    if (!shard.url || !shard.token) {
        throw new Error(`Redis shard ${shard.id} requires url and token`);
    }
    return shard;
}

function getRouter(env) {
    if (env && typeof env === 'object' && routerCache.has(env)) {
        return routerCache.get(env);
    }

    const shards = parseShardConfig(env);
    const router = {
        shards,
        ring: new ConsistentHashRing(shards, { virtualNodes: DEFAULT_VIRTUAL_NODES })
    };
    if (env && typeof env === 'object') routerCache.set(env, router);
    return router;
}

function validateTargetUrl(targetUrl, env) {
    let url;
    try {
        url = new URL(targetUrl);
    } catch (e) {
        throw new Error('targetUrl must be a valid URL');
    }

    if (url.origin !== getAppOrigin(env)) {
        throw new Error('targetUrl origin is not allowed');
    }

    if (!url.hash || url.hash.length < 2) {
        throw new Error('targetUrl must include an encoded plan hash');
    }

    return url.toString();
}

async function redisCommand(shard, command) {
    const response = await fetch(shard.url, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${shard.token}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify(command)
    });

    if (!response.ok) {
        throw new Error(`Redis shard ${shard.id} returned ${response.status}`);
    }

    const body = await response.json();
    if (body.error) {
        throw new Error(`Redis shard ${shard.id}: ${body.error}`);
    }
    return body.result;
}

function getShardForCode(code, env) {
    return getRouter(env).ring.getNode(code);
}

function storageKey(code) {
    return `uqtracker:short:${code}`;
}

async function getStoredUrl(code, env) {
    const router = getRouter(env);
    const primaryShard = router.ring.getNode(code);
    const key = storageKey(code);
    const primaryValue = await redisCommand(primaryShard, ['GET', key]);
    if (primaryValue) return primaryValue;

    // A topology change can move a key's ring assignment before its Redis data
    // is migrated. Search the remaining shards on a primary miss, then lazily
    // copy the value to its current owner so later reads use the O(log N) path.
    const fallbackResults = await Promise.allSettled(
        router.shards
            .filter(shard => shard.id !== primaryShard.id)
            .map(async shard => ({
                shard,
                value: await redisCommand(shard, ['GET', key])
            }))
    );
    const recovered = fallbackResults.find(result =>
        result.status === 'fulfilled' && result.value.value
    );
    if (!recovered) return null;

    await setStoredUrl(code, recovered.value.value, env);
    return recovered.value.value;
}

async function setStoredUrl(code, targetUrl, env) {
    const ttlSeconds = Number(env.LINK_TTL_SECONDS || DEFAULT_TTL_SECONDS);
    const shard = getShardForCode(code, env);
    return redisCommand(shard, ['SET', storageKey(code), targetUrl, 'EX', ttlSeconds]);
}

async function sha256Bytes(input) {
    const encoded = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return new Uint8Array(digest);
}

function toBase62(bytes) {
    let output = '';
    let value = 0;
    let bits = 0;

    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;

        while (bits >= 6 && output.length < CODE_LENGTH + 4) {
            bits -= 6;
            output += BASE62[((value >> bits) & 0x3f) % BASE62.length];
        }
    }

    return output || '0';
}

async function codeForTarget(targetUrl, attempt) {
    const salt = attempt === 0 ? '' : `:${attempt}`;
    const bytes = await sha256Bytes(`${targetUrl}${salt}`);
    return toBase62(bytes).slice(0, CODE_LENGTH);
}

async function createShortLink(request, env) {
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return jsonResponse({ error: 'Expected JSON body' }, { status: 400 });
    }

    let targetUrl;
    try {
        targetUrl = validateTargetUrl(body.targetUrl, env);
    } catch (e) {
        return jsonResponse({ error: e.message }, { status: 400 });
    }

    for (let attempt = 0; attempt < 8; attempt++) {
        const code = await codeForTarget(targetUrl, attempt);
        const existing = await getStoredUrl(code, env);

        if (!existing || existing === targetUrl) {
            await setStoredUrl(code, targetUrl, env);
            const shortUrl = new URL(request.url);
            shortUrl.pathname = `/${code}`;
            shortUrl.search = '';
            shortUrl.hash = '';
            return jsonResponse({ code, shortUrl: shortUrl.toString() }, { status: 201 });
        }
    }

    return jsonResponse({ error: 'Unable to allocate a short code' }, { status: 409 });
}

async function redirectShortLink(code, env) {
    if (!/^[0-9a-zA-Z]{4,32}$/.test(code)) {
        return jsonResponse({ error: 'Invalid short code' }, { status: 400 });
    }

    const targetUrl = await getStoredUrl(code, env);
    if (!targetUrl) {
        return jsonResponse({ error: 'Short link not found' }, { status: 404 });
    }

    return Response.redirect(targetUrl, 302);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders() });
        }

        try {
            if (request.method === 'POST' && url.pathname === '/api/links') {
                return createShortLink(request, env);
            }

            if (request.method === 'GET' && url.pathname.length > 1) {
                return redirectShortLink(url.pathname.slice(1), env);
            }

            return jsonResponse({ ok: true, service: 'uqtracker-shortener' });
        } catch (e) {
            return jsonResponse({ error: e.message || 'Unexpected shortener error' }, { status: 500 });
        }
    }
};
