import assert from 'node:assert/strict';
import test from 'node:test';

import { ConsistentHashRing } from './consistentHash.mjs';

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

    assert.equal(ring.size, 3);
    assert.equal(ring.ring.length, 450);
    assert.deepEqual(
        ring.ring.map(item => item.point),
        ring.ring.map(item => item.point).sort((left, right) => left - right)
    );
    assert.match(ring.getNode('plan-url-1').id, /^redis-[abc]$/);
});

test('limits key remapping across node changes for 10,000 synthetic URLs', () => {
    const keys = Array.from({ length: 10000 }, (_, index) => {
        return `https://uqtracker.vercel.app/#synthetic-plan-${index}`;
    });

    const fourShardRing = new ConsistentHashRing(['redis-a', 'redis-b', 'redis-c', 'redis-d']);
    const fiveShardRing = new ConsistentHashRing(['redis-a', 'redis-b', 'redis-c', 'redis-d', 'redis-e']);
    const threeShardRing = new ConsistentHashRing(['redis-a', 'redis-b', 'redis-d']);

    const base = assignments(fourShardRing, keys);
    const added = assignments(fiveShardRing, keys);
    const removed = assignments(threeShardRing, keys);

    assert.ok(remapRatio(base, added) < 0.35);
    assert.ok(remapRatio(base, removed) < 0.35);
});
