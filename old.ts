import { Map, List, Set, Range } from 'immutable'
import { applyOperation, applyPatch, compare, Operation } from 'fast-json-patch'

type PeerID = number

let peerStore = Set<Store>()

function notifyPeer(id: PeerID, ...args: any[]) {
    console.log('notifying peer', id, args[0]);

    // @ts-ignore
    peerStore.toArray()[id].onNotify(id, ...args)
}
function acknowledge(id: PeerID, counter: number) {
    console.log(`acking peer ${id}s delta ${counter}`);

    peerStore.toArray()[id].onAck(id, counter)
}

class Store {
    neighbors = List<PeerID>()
    ackMap = Map<PeerID, number>()
    state: Record<any, any> = {}
    oplog = Map<number, Operation>()
    counter = 0

    constructor(peers: any) {
        this.neighbors = List(peers)

        setInterval(() => {
            this.notify()
        }, 500)
    }

    set(path: string, value: any) {
        const patch: Operation = { op: 'replace', path: '/' + path, value }
        this.state = applyOperation(this.state, patch).newDocument
        this.oplog = this.oplog.set(this.counter++, patch)
    }

    addPeer(id: PeerID) {
        this.neighbors = this.neighbors.push(id)
        this.ackMap = this.ackMap.set(id, 0)
    }

    notify() {
        if (this.neighbors.isEmpty()) return
        const j = this.neighbors.get(Math.floor(Math.random() * this.neighbors.size))
        let delta: Record<any, any>
        if (this.oplog.isEmpty() || this.oplog.keySeq().min() > this.ackMap.get(j)) {
            delta = this.state
        } else {
            delta = applyPatch({}, this.oplog.skip(this.ackMap.get(j)).toArray().map(entry => entry[1])).newDocument
        }

        console.log(j, this.ackMap.get(j));

        if (this.ackMap.get(j) < this.counter) {
            // notify peer
            notifyPeer(j, delta, this.counter)
        }
    }

    onNotify(peer: PeerID, delta: Record<any, any>, counter: number) {
        if (!Map(delta).isSubset(Map(this.state).values())) {
            const ops = compare(this.state, delta)
            this.state = applyPatch(this.state, ops).newDocument
            for (let i = 0; i < ops.length; i++) {
                this.oplog.set(this.counter + i, ops[i])

            }
            this.counter++
        }
        acknowledge(peer, counter)
    }

    onAck(peer: PeerID, counter: number) {
        this.ackMap = this.ackMap.set(peer, Math.max(this.ackMap.get(peer), counter))
    }

    cleanup() {
        // get lowest ackno that has been acked by all parties
        const oldestAckedDelta = this.ackMap.valueSeq().min()
        this.oplog = this.oplog.slice(oldestAckedDelta)
    }
}

const s1 = new Store([])
peerStore = peerStore.add(s1)

const s2 = new Store([])
peerStore = peerStore.add(s2)
s1.addPeer(1)
s1.addPeer(0)

s1.set('foo', 'bar')
s1.set('hello', 'world')
s2.set('foo', 'baz')