// Tallennus Netlify Blobsiin. Paikallisissa testeissä (KT_LOCAL=1) käytetään muistia.

const mem = new Map();
const memStore = {
  async get(key, opts = {}) {
    const e = mem.get(key);
    if (!e) return null;
    if (opts.type === "json") return JSON.parse(Buffer.from(e.data).toString());
    if (opts.type === "arrayBuffer") return e.data;
    return Buffer.from(e.data).toString();
  },
  async getWithMetadata(key, opts = {}) {
    const e = mem.get(key);
    if (!e) return null;
    return { data: await this.get(key, opts), metadata: e.metadata };
  },
  async getMetadata(key) {
    const e = mem.get(key);
    return e ? { metadata: e.metadata } : null;
  },
  async set(key, data, opts = {}) {
    const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
    mem.set(key, { data: buf, metadata: opts.metadata || {} });
  },
  async setJSON(key, obj, opts = {}) {
    return this.set(key, JSON.stringify(obj), opts);
  },
  async delete(key) {
    mem.delete(key);
  },
  async list({ prefix = "" } = {}) {
    return { blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
  },
};

let blobs = null;
async function netlifyStore() {
  if (!blobs) {
    const { getStore } = await import("@netlify/blobs");
    blobs = getStore({ name: "kotitaulu", consistency: "strong" });
  }
  return blobs;
}

// Palauttaa olion, jonka metodit odottavat varsinaista säilöä laiskasti.
const lazy = new Proxy({}, {
  get: (_, method) => async (...args) => (await netlifyStore())[method](...args),
});

export function store() {
  return process.env.KT_LOCAL ? memStore : lazy;
}
