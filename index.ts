import { List, Map, mergeDeep } from 'immutable'
import { compare, applyPatch, Operation, deepClone, getValueByPointer } from 'fast-json-patch'
import { log } from 'console'


type PeerID = number
type Mutator = (state: Record<any, any>) => Record<any, any>

class Store {
    id: PeerID
    neighbors = List<Store>()
    state: Record<any, any> = {}
    ackMap = Map<PeerID, number>()
    deltas = List<List<Operation>>()
    counter = 0

    constructor(id: PeerID) {
        this.id = id

        setInterval(() => {
            const j = this.neighbors.get(Math.floor(Math.random() * this.neighbors.size))
            this.notify(j)
        }, 500)
    }

    commit(mutator: Mutator) {
        const newState = mutator(deepClone(this.state))
        const patch = compare(this.state, newState)

        this.state = applyPatch(this.state, patch).newDocument
        this.deltas = this.deltas.set(this.counter, List(patch))
        this.counter++
    }

    addPeer(peer: Store) {
        this.neighbors = this.neighbors.push(peer)
        this.ackMap = this.ackMap.set(peer.id, 0)
    }

    notify(peer: Store) {
        if (this.neighbors.isEmpty()) return
        let delta: Operation[]
        // if our deltas is empty OR they ask for an older delta than we have...
        if (this.deltas.isEmpty() || this.deltas.keySeq().min() > this.ackMap.get(peer.id)) {
            // ...we send the whole state
            delta = compare({}, this.state)
        } else {
            // otherwise we send all the deltas that happened since the last acked message
            delta = this.deltas.slice(this.ackMap.get(peer.id), this.counter).flatMap(delta => delta.values()).toArray()
        }

        // only notify the peer our counter is bigger then theirs.
        // this means we have new information to share.
        if (this.ackMap.get(peer.id) < this.counter) {
            peer.onNotify(this, delta, this.counter)
        }
    }

    onNotify(peer: Store, delta: Operation[], remoteCounter: number) {
        console.log(`${this.id}: got notified by peer ${peer.id}`)
        if (!isSubset(this.state, delta)) {
            this.state = applyPatch(this.state, delta).newDocument
            this.deltas = this.deltas.set(this.counter, List(delta))
            this.counter++
        }
        peer.onAck(this, remoteCounter)
    }

    onAck(peer: Store, ackedCounter: number) {
        this.ackMap = this.ackMap.set(peer.id, Math.max(this.ackMap.get(peer.id), ackedCounter))
    }
}

function isSubset(obj: Record<any, any>, patch: Operation[]) {
    for (const operation of patch) {
        if ('value' in operation && getValueByPointer(obj, operation.path) !== operation.value) return false
    }
    return true
}

function set(key: string, value: any): Mutator {
    return (state) => {
        state[key] = value
        return state
    }
}

const s1 = new Store(1)
const s2 = new Store(2)
s1.addPeer(s2)
s2.addPeer(s1)

s1.commit(set('foo', 'bar'))
s2.commit(set('fizz', 'buzz'))


setTimeout(() => {
    console.log(s1.state);
    console.log(s2.state);

}, 2000)