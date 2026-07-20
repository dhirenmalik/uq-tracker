import assert from 'node:assert/strict';
import test from 'node:test';

import { ConsistentHashRing, DEFAULT_VIRTUAL_NODES } from './consistentHash.mjs';

function assignments(ring, keys) {
    const map = new Map();
    keys.forEach(key => {
        map.set(key, ring.getNode(key).id);
    });
    return map;
}

function remapRatio(before, after) {
    let changed = 0;
    before.forEach((nodeId, key) => {
        if (after.get(key) !== nodeId) changed++;
    });
    return changed / before.size;
}

test('looks up nodes with binary-searchable ring points', () => {
    const ring = new ConsistentHashRing(['redis-a', 'redis-b', 'redis-c']);

    assert.equal(DEFAULT_VIRTUAL_NODES, 150);
    assert.equal(ring.size, 3);
    assert.equal(ring.ring.length, 3 * DEFAULT_VIRTUAL_NODES);
    assert.deepEqual(
        ring.ring.map(item => item.point),
        ring.ring.map(item => item.point).sort((left, right) => left - right)
    );
    assert.match(ring.getNode('plan-url-1').id, /^redis-[abc]$/);
});

test('uses logarithmic ring reads for lookup', () => {
    const ring = new ConsistentHashRing(
        Array.from({ length: 1000 }, (_, index) => `redis-${index}`)
    );
    const points = ring.ring;
    let pointReads = 0;
    ring.ring = new Proxy(points, {
        get(target, property, receiver) {
            if (/^\d+$/.test(String(property))) pointReads++;
            return Reflect.get(target, property, receiver);
        }
    });

    ring.getNode('https://uq-tracker.vercel.app/#complexity-check');

    const binarySearchBound = Math.ceil(Math.log2(points.length)) + 2;
    assert.ok(pointReads <= binarySearchBound, `${pointReads} reads exceeded ${binarySearchBound}`);
});

test('limits key remapping across node changes for 10,000 synthetic URLs', () => {
    const keys = Array.from({ length: 10000 }, (_, index) => {
        return `https://uq-tracker.vercel.app/#synthetic-plan-${index}`;
    });

    const fourShardRing = new ConsistentHashRing(['redis-a', 'redis-b', 'redis-c', 'redis-d']);
    const fiveShardRing = new ConsistentHashRing(['redis-a', 'redis-b', 'redis-c', 'redis-d', 'redis-e']);
    const threeShardRing = new ConsistentHashRing(['redis-a', 'redis-b', 'redis-d']);

    const base = assignments(fourShardRing, keys);
    const added = assignments(fiveShardRing, keys);
    const removed = assignments(threeShardRing, keys);

    const addedRatio = remapRatio(base, added);
    const removedRatio = remapRatio(base, removed);

    // Adding one node to four should move about 20% of keys; removing one of
    // four should move about 25%. Virtual nodes keep both close to expectation.
    assert.ok(addedRatio > 0.14 && addedRatio < 0.27, `unexpected add-node remap ratio: ${addedRatio}`);
    assert.ok(removedRatio > 0.18 && removedRatio < 0.32, `unexpected remove-node remap ratio: ${removedRatio}`);
});
