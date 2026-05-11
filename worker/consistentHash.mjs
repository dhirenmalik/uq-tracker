export const DEFAULT_VIRTUAL_NODES = 150;

function fnv1a32(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
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
                    point: fnv1a32(`${node.id}:${i}`),
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

        const point = fnv1a32(String(key));
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
