export const DEFAULT_VIRTUAL_NODES = 150;

function murmur3_32(input, seed = 0) {
    const text = String(input);
    let hash = seed >>> 0;
    let index = 0;

    while (index + 4 <= text.length) {
        let chunk = text.charCodeAt(index)
            | (text.charCodeAt(index + 1) << 8)
            | (text.charCodeAt(index + 2) << 16)
            | (text.charCodeAt(index + 3) << 24);
        chunk = Math.imul(chunk, 0xcc9e2d51);
        chunk = (chunk << 15) | (chunk >>> 17);
        chunk = Math.imul(chunk, 0x1b873593);

        hash ^= chunk;
        hash = (hash << 13) | (hash >>> 19);
        hash = (Math.imul(hash, 5) + 0xe6546b64) | 0;
        index += 4;
    }

    let tail = 0;
    switch (text.length & 3) {
        case 3:
            tail ^= text.charCodeAt(index + 2) << 16;
        // fall through
        case 2:
            tail ^= text.charCodeAt(index + 1) << 8;
        // fall through
        case 1:
            tail ^= text.charCodeAt(index);
            tail = Math.imul(tail, 0xcc9e2d51);
            tail = (tail << 15) | (tail >>> 17);
            tail = Math.imul(tail, 0x1b873593);
            hash ^= tail;
    }

    hash ^= text.length;
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
    return hash >>> 0;
}

function normalizeNode(node) {
    if (typeof node === 'string') return { id: node };
    if (node && typeof node.id === 'string') return node;
    throw new Error('Hash ring nodes must be strings or objects with an id');
}

export class ConsistentHashRing {
    constructor(nodes, options = {}) {
        this.virtualNodes = options.virtualNodes || DEFAULT_VIRTUAL_NODES;
        this.nodes = (nodes || []).map(normalizeNode);
        this.ring = [];

        this.nodes.forEach(node => {
            for (let i = 0; i < this.virtualNodes; i++) {
                this.ring.push({
                    point: murmur3_32(`${node.id}:${i}`),
                    node
                });
            }
        });

        this.ring.sort((left, right) => {
            if (left.point !== right.point) return left.point - right.point;
            return left.node.id.localeCompare(right.node.id);
        });
    }

    get size() {
        return this.nodes.length;
    }

    getNode(key) {
        if (this.ring.length === 0) {
            throw new Error('Cannot route keys without at least one hash ring node');
        }

        const point = murmur3_32(String(key));
        let low = 0;
        let high = this.ring.length - 1;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (this.ring[mid].point < point) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        return this.ring[low === this.ring.length ? 0 : low].node;
    }
}

export function createRing(nodes, options) {
    return new ConsistentHashRing(nodes, options);
}
