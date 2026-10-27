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

let mod = null;
let strongWorks = true;

// Huom: säilöä EI saa ottaa talteen kutsujen välillä. Netlify antaa jokaiselle
// funktiokutsulle oman lyhytikäisen tunnisteen, ja talteen otettu säilö käyttäisi
// vanhentunutta tunnistetta ("Failed to decode token: Token expired").
async function stores() {
  if (!mod) {
    try {
      mod = await import("@netlify/blobs");
    } catch (e) {
      throw new Error(`Netlify Blobs -kirjasto puuttuu julkaisusta (${e.message}). Tarkista, että package.json on repon juuressa.`);
    }
  }
  const plain = mod.getStore("kotitaulu");
  let strong = null;
  if (strongWorks) {
    try {
      strong = mod.getStore({ name: "kotitaulu", consistency: "strong" });
    } catch {
      strongWorks = false;
    }
  }
  return { strong, plain };
}

async function call(method, args) {
  const { strong: s, plain: p } = await stores();
  if (s) {
    try {
      return await s[method](...args);
    } catch (e) {
      // Joissain ympäristöissä vahva yhdenmukaisuus ei ole käytettävissä; käytetään tavallista tilaa.
      console.error(`Blobs (strong) ${method} epäonnistui, kokeillaan tavallista:`, e?.message);
      strongWorks = false;
    }
  }
  try {
    return await p[method](...args);
  } catch (e) {
    console.error(`Blobs ${method} epäonnistui:`, e);
    throw new Error(`Tallennustila ei vastannut: ${e?.message || e}`);
  }
}

// Palauttaa olion, jonka metodit odottavat varsinaista säilöä laiskasti.
const lazy = new Proxy({}, {
  get: (_, method) => (method === "then" ? undefined : (...args) => call(method, args)),
});

export function store() {
  return process.env.KT_LOCAL ? memStore : lazy;
}
