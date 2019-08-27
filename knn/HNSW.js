import euclidean from '../metrics/euclidean';
import { Heap } from '../datastructure/Heap';
/**
 * @memberof module:knn
 */

export class HNSW {
    /**
     * 
     * @param {*} metric metric to use: (a, b) => distance
     * @param {*} heuristic use heuristics or naive selection
     * @param {*} m max number of connections
     * @param {*} ef size of candidate list
     * @param {*} m0 max number of connections for ground layer 
     * @see {@link https://arxiv.org/abs/1603.09320}
     */
    constructor(metric = euclidean, heuristic = true, m = 5, ef = 200, m0 = null, mL = null) {
        this._metric = metric;
        this._select = heuristic ? this._select_heuristic : this._select_simple;
        this._m = m;
        this._ef = ef;
        this._m0 = m0 || 2 * m;
        this._graph = [];
        this._ep = null;
        this._L = null;
        this._mL = mL === null ? 1 / Math.log2(m) : mL;
        this.search = this.search;
    }

    addOne(element) {
        this.add([element])
    }

    add(...elements) {
        const m = this._m;
        const ef = this._ef;
        const m0 = this._m0;
        //const metric = this._metric;
        const mL = this._mL;
        let graph = this._graph;
        for (const element of elements) {
            let ep = this._ep ? Array.from(this._ep): null;
            let W = [];
            let L = this._L;
            let l = Math.floor(-Math.log(Math.random() * mL))
            let min_L_l = Math.min(L, l);
            if (L) {
                for (let l_c = graph.length - 1; l_c > min_L_l; --l_c) {
                    ep = this._search_layer(element, ep, 1, l_c);
                }
                for (let l_c = min_L_l; l_c >= 0; --l_c) {
                    let layer_c = graph[l_c];
                    layer_c.points.push(element)
                    W = this._search_layer(element, ep, ef, l_c);
                    let neighbors = this._select(element, W, m, l_c);
                    neighbors.forEach(p => {
                        if (p !== element) {
                            //let distance = metric(p, element);
                            layer_c.edges.push({
                                idx1: p, 
                                idx2: element, 
                                ///distance: distance
                            });
                            layer_c.edges.push({
                                idx1: element, 
                                idx2: p, 
                                //distance: distance
                            });
                        }
                    });
                    let max = (l_c === 0 ? m0 : m);
                    for (let e of neighbors) {
                        let e_conn = layer_c.edges
                            .filter(edge => edge.idx1 === e)
                            .map(edge => edge.idx2);
                        if (e_conn.length > max) {
                            let neighborhood = this._select(e, e_conn, max, l_c);
                            layer_c.edges = layer_c.edges
                                .filter(edge => edge.idx1 !== e);
                            neighborhood.forEach(neighbor => {
                                if (e !== neighbor) {
                                    //let distance = metric(e, neighbor);
                                    layer_c.edges.push({
                                        idx1: e, 
                                        idx2: neighbor, 
                                        //distance: distance
                                    });
                                }
                            })
                        }
                    }
                    ep = W;
                }
            }
            if (graph.length < l || l > L) {
                for (let i = l, n = graph.length; i >= n; --i) {
                    let new_layer = {
                        l_c: i, 
                        points: [element], 
                        edges: new Array()
                    };
                    graph.push(new_layer);
                    if (i === l) {
                        this._ep = [element];
                        this._L = l;
                    }
                }
                graph = graph.sort((a, b) => a.l_c - b.l_c);
            }
        }
        return this;
    }

    _select_heuristic(q, candidates, M, l_c, extend_candidates = true, keep_pruned_connections = true) {
        if (l_c > this._graph.length - 1) return candidates
        const metric = this._metric;
        const layer = this._graph[l_c];
        let R = [];
        let W_set = new Set(candidates);
        if (extend_candidates) {
            for (let c of candidates) {
                for (let {idx2: c_adj} of layer.edges.filter(edge => edge.idx1 === c)) {
                    W_set.add(c_adj)
                }
            }
        }
        let W = new Heap(Array.from(W_set), d => metric(d, q), "min")
        let W_d = new Heap(null, d => metric(d, q), "min");
        while (W.first && R.length < M) {
            let e = W.pop()
            let random_r = Math.floor(Math.random() * R.length)
            if (R.length === 0 || e.value < metric(R[random_r], q)) {
                R.push(e.element);
            } else {
                W_d.push(e.element)
            }
        }
        if (keep_pruned_connections) {
            while (W_d.first && R.length < M) {
                R.push(W_d.pop().element)
            }
        }
        return R
    }

    _select_simple(q, C, M) {
        const metric = this._metric;
        let res = C.sort((a,b) => metric(a, q) - metric(b, q)).slice(0,M);
        return res
    }

    _search_layer(q, ep, ef, l_c) {
        const metric = this._metric;
        const layer = this._graph.find(l => l.l_c === l_c);
        let v = new Set(ep);
        let C = new Heap(ep, d => metric(d, q), "min");
        let W = new Heap(ep, d => metric(d, q), "max");
        while (C.length > 0) {
            let c = C.pop();
            let f = W.first;
            if (c.value > f.value) {
                break;
            }
            for (let {idx2: e} of layer.edges.filter(e => e.idx1 === c.element)) {
                if (!v.has(e)) {
                    v.add(e);
                    f = W.first.element;
                    if (metric(e, q) < metric(f, q) || W.length < ef) {
                        C.push(e);
                        W.push(e);
                        if (W.length > ef) {
                            W.pop();
                        }
                    }
                }
            }
        }
        return W.toArray().reverse().slice(0, ef);
    }

    search(q, K, ef = null) {
        ef = ef || 1;
        let ep = this._ep;
        let L = this._L;
        for (let l_c = L; l_c > 0; --l_c) {
            ep = this._search_layer(q, ep, ef, l_c);
        }
        ep = this._search_layer(q, ep, K, 0);
        return ep;
    }

    * search_iter(q, K, ef = null) {
        ef = ef || 1;
        let ep = this._ep ? Array.from(this._ep): null;
        let L = this._L;
        yield{l_c: L, ep: [q]}
        for (let l_c = L; l_c > 0; --l_c) {
            yield {l_c: l_c, ep: ep}
            ep = this._search_layer(q, ep, ef, l_c);
            yield {l_c: l_c, ep: ep}
        }
        yield {l_c: 0, ep: ep}
        ep = this._search_layer(q, ep, K, 0);
        yield {l_c: 0, ep: ep}
    }
}