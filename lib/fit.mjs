// Pieni riippuvuukseton FIT-lukija: purkaa Garminin ZIP-paketin ja poimii VO2max-arvon,
// kierrokset (lap, viesti 19) ja nopeimmat matkat tallennuspisteistä (record, viesti 20).
// Lähteet: 1) dokumentoitu max_met_data (globaali viesti 229, kenttä 2, skaala 10)
//          2) Garminin dokumentoimaton viesti 140, kenttä 7 (arvo × 3,5 / 65536 = ml/kg/min)
import { inflateRawSync } from "node:zlib";

// ---------- ZIP ----------
export function unzipFirst(buf) {
  // Jos tiedosto on jo FIT (".FIT" tavuissa 8–11), palautetaan sellaisenaan
  if (buf.length > 12 && buf.toString("ascii", 8, 12) === ".FIT") return buf;
  // Etsitään keskushakemiston loppu (EOCD)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP-tiedostoa ei tunnistettu");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commLen;
    if (!/\.fit$/i.test(name)) continue;
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + csize);
    if (method === 0) return data;
    if (method === 8) return inflateRawSync(data);
    throw new Error(`Tuntematon pakkaustapa ${method}`);
  }
  throw new Error("ZIP-paketissa ei ollut FIT-tiedostoa");
}

// ---------- FIT ----------
// Palauttaa { vo2: [{ value, sport }], counts: { globaali viestinumero: kpl } }
export function readFitVo2(fit) { return readFit(fit); }

const BEST = [1000, 5000, 10000, 21097, 42195];
export function readFit(fit) {
  const out = { vo2: [], counts: {}, m140: null, laps: [], best: null, dyn: null };
  const rt = [], rd = [];
  let lastTs = null;
  let off = 0;
  // Tiedostoja voi olla useita peräkkäin
  while (off + 12 <= fit.length) {
    const hSize = fit[off];
    const dataSize = fit.readUInt32LE(off + 4);
    if (fit.toString("ascii", off + 8, off + 12) !== ".FIT") break;
    let p = off + hSize;
    const end = Math.min(fit.length, p + dataSize);
    const defs = {};
    while (p < end) {
      const hdr = fit[p++];
      let local, isDef = false, cts = null;
      if (hdr & 0x80) { // pakattu aikaleima
        local = (hdr >> 5) & 0x03;
        const offs = hdr & 0x1f;
        if (lastTs != null) { cts = (lastTs & ~0x1f) + offs; if (offs < (lastTs & 0x1f)) cts += 0x20; lastTs = cts; }
      } else { local = hdr & 0x0f; isDef = !!(hdr & 0x40); }
      if (isDef) {
        const devFlag = !!(hdr & 0x20);
        const big = fit[p + 1] === 1;
        const global = big ? fit.readUInt16BE(p + 2) : fit.readUInt16LE(p + 2);
        const n = fit[p + 4];
        p += 5;
        const fields = [];
        for (let i = 0; i < n; i++) { fields.push({ num: fit[p], size: fit[p + 1], type: fit[p + 2] }); p += 3; }
        let devSize = 0;
        if (devFlag) { const dn = fit[p++]; for (let i = 0; i < dn; i++) { devSize += fit[p + 1]; p += 3; } }
        defs[local] = { global, big, fields, devSize };
      } else {
        const d = defs[local];
        if (!d) throw new Error("FIT: määrittelemätön viesti");
        out.counts[d.global] = (out.counts[d.global] || 0) + 1;
        const readRec = () => {
          const rec = {};
          let q = p;
          for (const f of d.fields) {
            if (f.size === 1) rec[f.num] = fit[q];
            else if (f.size === 2) rec[f.num] = d.big ? fit.readUInt16BE(q) : fit.readUInt16LE(q);
            else if (f.size === 4) rec[f.num] = d.big ? fit.readUInt32BE(q) : fit.readUInt32LE(q);
            q += f.size;
          }
          return rec;
        };
        if (d.fields.some(f => f.num === 253) && (d.global === 20 || d.global === 19 || d.global === 18)) {
          const r = readRec();
          if (r[253] != null && r[253] !== 0xffffffff) lastTs = r[253];
        }
        if (d.global === 20) {
          const r = readRec();
          const ts = r[253] ?? cts;
          const dist = r[5];
          if (ts != null && dist != null && dist !== 0xffffffff) { rt.push(ts); rd.push(dist / 100); }
        }
        if (d.global === 18) {
          // session: juoksun dynamiikka (askeltiheys, pystyliike, maakosketus, pystysuhde, tasapaino, askelpituus)
          const r = readRec();
          const u16 = (v, sc) => (v == null || v === 0xffff || v === 0 ? null : v / sc);
          const cad = r[18] != null && r[18] !== 0xff ? (r[18] + (r[92] != null && r[92] !== 0xff ? r[92] / 128 : 0)) * 2 : null;
          const dyn = { cad, vo: u16(r[89], 100), gct: u16(r[91], 10), vr: u16(r[132], 100), bal: u16(r[133], 100), stride: u16(r[134], 10000) };
          if (Object.values(dyn).some(v => v != null)) out.dyn = dyn;
        }
        if (d.global === 19) {
          const r = readRec();
          const u32 = (v, sc) => (v == null || v === 0xffffffff ? null : v / sc);
          const u16 = (v, sc) => (v == null || v === 0xffff ? null : v / sc);
          const u8 = (v) => (v == null || v === 0xff ? null : v);
          out.laps.push({
            t: u32(r[8], 1000) ?? u32(r[7], 1000), d: u32(r[9], 100),
            hr: u8(r[15]), mhr: u8(r[16]), spd: u32(r[110], 1000) ?? u16(r[13], 1000),
          });
        }
        if (d.global === 140) {
          const rec = readRec();
          out.m140 = rec;
          const raw = rec[7];
          if (raw != null && raw !== 0xffffffff && raw !== 0xffff) {
            const value = Math.round((raw * 3.5 / 65536) * 10) / 10;
            if (value >= 15 && value <= 100) out.vo2.push({ value, sport: null, src: 140 });
          }
        }
        if (d.global === 229) {
          const rec = readRec();
          let raw = rec[2];
          if (raw == null || raw === 0xffff) {
            // varalla: mikä tahansa 2-tavuinen kenttä, joka näyttää VO2max-arvolta
            raw = Object.entries(rec).map(([, v]) => v).find(v => v !== 0xffff && v / 10 >= 20 && v / 10 <= 95 && v < 0x10000);
          }
          if (raw != null && raw !== 0xffff) {
            const value = raw / 10;
            if (value >= 15 && value <= 100) out.vo2.push({ value, sport: rec[5] ?? null, src: 229 });
          }
        }
        p += d.fields.reduce((s, f) => s + f.size, 0) + d.devSize;
      }
    }
    off = end + 2; // CRC
  }
  // Nopeimmat matkat liukuvalla ikkunalla
  if (rd.length > 10) {
    const best = {};
    for (const D of BEST) {
      if (rd[rd.length - 1] - rd[0] < D) continue;
      let j = 0, min = Infinity;
      for (let i = 0; i < rd.length; i++) {
        while (j < rd.length && rd[j] - rd[i] < D) j++;
        if (j >= rd.length) break;
        const t = rt[j] - rt[i];
        if (t > 0 && t < min) min = t;
      }
      if (isFinite(min)) best[D] = min;
    }
    if (Object.keys(best).length) out.best = best;
  }
  out.laps = out.laps.filter(l => l.t != null);
  return out;
}

