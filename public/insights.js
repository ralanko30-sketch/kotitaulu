// Treeniehdotukset, viimeisimmän treenin analyysi ja VO2max-seuranta.
import { SPORTS, SPORT_KEYS, ITYPES, ITYPE_KEYS, HR_REF, hrNorm, fmtNorm, addDays, startOfDay, dayKey, parseDay, weekdayIdx, weekStart, fmtDur, fmtNum, fmtPace, fmtKm, fmtH, isoWeekNum } from "./model.js";

const HARD = new Set(["threshold", "vo2", "anaerobic"]);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const median = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const r5 = (min) => Math.max(20, Math.round(min / 5) * 5);

// ---------- sykealueiden tekstit ----------
function zoneText(zones, a, b = a) {
  const label = a === b ? `Z${a}` : `Z${a}–Z${b}`;
  const lo = zones?.[a - 1]?.lo, hi = zones?.[b - 1]?.hi;
  if (lo && hi) return `${label} (${lo}–${hi} bpm)`;
  if (lo) return `${label} (yli ${lo} bpm)`;
  return label;
}

// ---------- VO2max ----------
export function vo2Data(acts, today = new Date(), hist = {}) {
  const series = (sp) => {
    const byDay = {};
    for (const a of acts) if (a.sport === sp && a.vo2) byDay[a.day] = { x: a.date, y: a.vo2, a };
    for (const [d, v] of Object.entries(hist || {})) {
      const y = v?.[sp];
      if (y && !byDay[d]) { const [Y, M, D] = d.split("-").map(Number); byDay[d] = { x: new Date(Y, M - 1, D, 12), y, a: null }; }
    }
    return Object.values(byDay).sort((p, q) => p.x - q.x);
  };
  const run = series("run"), bike = series("bike");
  const main = run.length ? "run" : bike.length ? "bike" : null;
  if (!main) return { run, bike, main: null };
  const pts = main === "run" ? run : bike;
  const latest = pts[pts.length - 1];
  const before = (days) => [...pts].reverse().find(p => p.x <= addDays(today, -days));
  const d30 = before(30), d90 = before(90);
  const recent180 = pts.filter(p => p.x >= addDays(today, -180));
  const best = recent180.reduce((m, p) => (p.y > (m?.y || 0) ? p : m), null);
  return {
    run, bike, main, latest,
    ch30: d30 ? latest.y - d30.y : null,
    ch90: d90 ? latest.y - d90.y : null,
    best,
    daysOld: Math.round((startOfDay(today) - startOfDay(latest.x)) / 864e5),
  };
}

export function fitnessAgeInfo(fa) {
  if (!fa || typeof fa !== "object") return null;
  const pick = (re) => {
    for (const [k, v] of Object.entries(fa)) if (re.test(k) && typeof v === "number") return v;
    return null;
  };
  const fit = pick(/^fitnessAge$/i), chrono = pick(/chronologicalAge/i), achievable = pick(/achievableFitnessAge/i);
  return fit != null ? { fit, chrono, achievable } : null;
}

// ---------- treenipohjat ----------
function templates({ zones, easyPace, easyRunMin, easyBikeMin, minutes }) {
  const z = (a, b) => zoneText(zones, a, b);
  const pace = easyPace ? ` (noin ${easyPace})` : "";
  const runBase = minutes || r5(Math.min(70, Math.max(35, easyRunMin || 50)));
  const bikeBase = minutes || r5(Math.min(120, Math.max(50, easyBikeMin || 75)));
  const runLong = minutes || 80, bikeLong = minutes || 120;
  const runRec = minutes || 30, bikeRec = minutes || 40;
  return [
    { id: "run_vo2", sport: "run", itype: "vo2", cls: "hard", title: "VO2max-intervallit 5 × 3 min", min: 50,
      steps: [
        ["Lämmittely 15 min", `Rauhallista hölkkää ${z(1, 2)}, lopuksi 3 × 20 s reippaat vedot.`],
        ["Pääosa 5 × 3 min", `Kovaa ${z(5)}, tuntumaltaan noin 3–5 km:n kisavauhti. Palautus vetojen välissä 2 min kevyttä hölkkää ${z(1)}.`],
        ["Loppuverryttely 10 min", `Kevyt hölkkä ${z(1)}.`],
      ],
      tip: "Pidä vedot tasaisina: viimeinen yhtä kova kuin ensimmäinen. Jos vauhti hiipuu selvästi, jätä viimeinen veto pois." },
    { id: "run_threshold", sport: "run", itype: "threshold", cls: "hard", title: "Kynnysintervallit 4 × 6 min", min: 55,
      steps: [
        ["Lämmittely 15 min", `Rauhallista hölkkää ${z(1, 2)}.`],
        ["Pääosa 4 × 6 min", `Reipas mutta hallittu ${z(4)}, tuntumaltaan 10 km – puolimaratonin kisavauhti. Palautus 90 s hölkäten.`],
        ["Loppuverryttely 10 min", `Kevyt hölkkä ${z(1)}.`],
      ],
      tip: "Puhuminen onnistuu vain muutaman sanan kerrallaan. Kynnystreeni nostaa vauhtia, jota jaksat pitkään." },
    { id: "run_tempo", sport: "run", itype: "tempo", cls: "hard", title: "Tempojuoksu 20 min", min: 45,
      steps: [
        ["Lämmittely 15 min", `Rauhallista hölkkää ${z(1, 2)}.`],
        ["Pääosa 20 min", `Tasaista, reipasta juoksua ${z(3)}.`],
        ["Loppuverryttely 10 min", `Kevyt hölkkä ${z(1)}.`],
      ],
      tip: "Tasainen syke koko 20 minuutin ajan on tärkeämpää kuin vauhti." },
    { id: "run_hills", sport: "run", itype: "anaerobic", cls: "hard", title: "Mäkivedot 8 × 45 s", min: 45,
      steps: [
        ["Lämmittely 15 min", `Rauhallista hölkkää ${z(1, 2)} + 3 × 20 s vedot tasamaalla.`],
        ["Pääosa 8 × 45 s", `Reippaasti ylämäkeen ${z(4, 5)}, hyvä juoksuasento ja polvennosto. Palautus kävellen tai hölkäten alas.`],
        ["Loppuverryttely 10 min", `Kevyt hölkkä ${z(1)}.`],
      ],
      tip: "Kehittää voimaa ja juoksun taloudellisuutta. Sopii myös HYROX-juoksuihin." },
    { id: "run_base", sport: "run", itype: "base", cls: "easy", title: `Peruskestävyyslenkki ${runBase} min`, min: runBase,
      steps: [
        [`${runBase} min tasaista`, `Rauhallista juoksua ${z(2)}${pace}. Pysy keskustelutahdissa.`],
        ["Lopuksi (valinnainen)", "4 × 20 s rennot vedot tasamaalla, palautus kävellen."],
      ],
      tip: "Peruskestävyys on kunnon pohja. Jos syke nousee alueelle 3, hidasta tai kävele mäet." },
    { id: "run_long", sport: "run", itype: "base", cls: "long", title: `Pitkä lenkki ${fmtDur(runLong * 60)}`, min: runLong,
      steps: [
        [`${runLong} min tasaista`, `Rauhallista juoksua ${z(2)}${pace}. Syke ei nouse alueelle 3 ylämäissäkään.`],
        ["Tankkaus", "Ota mukaan juotavaa. Yli 75 min lenkillä energiaa noin 30 g tunnissa."],
      ],
      tip: "Pitkä lenkki parantaa rasvan käyttöä energiaksi ja lihaskestävyyttä." },
    { id: "run_recovery", sport: "run", itype: "recovery", cls: "recovery", title: `Palauttava hölkkä ${runRec} min`, min: runRec,
      steps: [[`${runRec} min hyvin kevyesti`, `${z(1)}. Saa kävellä välissä.`]],
      tip: "Edistää palautumista verenkierron kautta. Tämän pitää tuntua helpolta." },
    { id: "bike_threshold", sport: "bike", itype: "threshold", cls: "hard", title: "Kynnysintervallit 3 × 10 min", min: 70,
      steps: [
        ["Lämmittely 15 min", `Kevyesti ${z(1, 2)}, lopuksi 2 × 30 s reippaasti.`],
        ["Pääosa 3 × 10 min", `${z(4)}, tasainen teho ja kadenssi 85–95. Palautus 5 min kevyesti ${z(1)}.`],
        ["Loppuverryttely 10 min", `Kevyesti ${z(1)}.`],
      ],
      tip: "Hyvä sisäpyörällä tai tasaisella tiellä, jotta teho pysyy tasaisena." },
    { id: "bike_vo2", sport: "bike", itype: "vo2", cls: "hard", title: "VO2max-intervallit 5 × 4 min", min: 65,
      steps: [
        ["Lämmittely 15 min", `Kevyesti ${z(1, 2)}.`],
        ["Pääosa 5 × 4 min", `Kovaa ${z(5)}. Palautus 4 min kevyesti.`],
        ["Loppuverryttely 10 min", `Kevyesti ${z(1)}.`],
      ],
      tip: "Kova mutta tasainen. Viimeisen vedon pitää olla yhtä kova kuin ensimmäisen." },
    { id: "bike_base", sport: "bike", itype: "base", cls: "easy", title: `Peruskestävyyslenkki ${bikeBase} min`, min: bikeBase,
      steps: [[`${bikeBase} min tasaista`, `${z(2)}, kadenssi 85–95. Kevyet vaihteet ylämäissä.`]],
      tip: "Pyörällä saa paljon aerobista harjoitusta pienellä rasituksella jaloille." },
    { id: "bike_long", sport: "bike", itype: "base", cls: "long", title: `Pitkä lenkki ${fmtDur(bikeLong * 60)}`, min: bikeLong,
      steps: [[`${fmtDur(bikeLong * 60)} tasaista`, `${z(2)}. Syö ja juo tasaisesti, noin 30–60 g hiilihydraattia tunnissa.`]],
      tip: "Rauhallinen pitkä lenkki kasvattaa kestävyyttä ilman suurta palautumistarvetta." },
    { id: "bike_recovery", sport: "bike", itype: "recovery", cls: "recovery", title: `Palauttava pyöräily ${bikeRec} min`, min: bikeRec,
      steps: [[`${bikeRec} min hyvin kevyesti`, `${z(1)}, kevyt vaihde ja korkea kadenssi.`]],
      tip: "Kevyt pyöräily vauhdittaa palautumista kovan treenin jälkeen." },
    { id: "hyrox_run", sport: "hyrox", itype: "threshold", cls: "hard", title: "HYROX: juoksu + asemat 4 kierrosta", min: 60, hyrox: true,
      steps: [
        ["Lämmittely 10 min", "Hölkkä 5 min + 2 kierrosta: 10 kyykkyä, 10 punnerrusta, 10 m karhukävely."],
        ["Kierros 1", `1 km juoksu ${z(4)} (kisavauhti) → heti 50 wall ballia (6 kg / 9 kg).`],
        ["Kierros 2", `1 km juoksu ${z(4)} → 100 m hiekkasäkkiaskelkyykky (10 kg / 20 kg).`],
        ["Kierros 3", `1 km juoksu ${z(4)} → 1000 m soutu.`],
        ["Kierros 4", `1 km juoksu ${z(4)} → 20 burpee broad jumpia.`],
        ["Palautus", "2 min kävely kierrosten välissä. Lopuksi 5 min kevyt hölkkä ja venyttely."],
      ],
      tip: "Paina lap-nappia jokaisen osuuden vaihtuessa, niin näet, paljonko juoksu hidastuu asemien jälkeen." },
    { id: "hyrox_stations", sport: "hyrox", itype: "strength", cls: "strength", title: "HYROX: asemat ja voimakestävyys", min: 50, hyrox: true,
      steps: [
        ["Lämmittely 10 min", "Soutu tai SkiErg kevyesti 5 min + lonkan ja olkapäiden liikkuvuus."],
        ["4 kierrosta", "Sled push 25 m (raskas) → sled pull 25 m → farmers carry 50 m (2 × 24 kg / 2 × 32 kg) → 15 wall ballia. Palautus 90 s kierrosten välissä."],
        ["Loppuun", `SkiErg 3 × 500 m ${z(4)}, palautus 1 min.`],
      ],
      tip: "Jos kelkkaa ei ole, korvaa sled push raskaalla askelkyykkykävelyllä ja sled pull kuminauhasoudulla." },
    { id: "strength_full", sport: "strength", itype: "strength", cls: "strength", title: "Voimatreeni, koko keho", min: 55,
      steps: [
        ["Lämmittely 8 min", "Kevyt soutu tai pyöräily + 2 kevyttä sarjaa ensimmäiseen liikkeeseen."],
        ["Takakyykky", "4 × 5–6, raskas mutta 2 toistoa varaan. Palautus 2–3 min."],
        ["Romanialainen maastaveto", "3 × 8."],
        ["Penkkipunnerrus tai punnerrus", "4 × 6–8."],
        ["Kulmasoutu", "3 × 8–10."],
        ["Askelkyykky", "3 × 10 / jalka."],
        ["Keskivartalo", "Pallof press 3 × 10 / puoli + lankku 3 × 40 s."],
      ],
      tip: "Voima suojaa vammoilta ja parantaa juoksun taloudellisuutta. Nosta painoja, kun kaikki sarjat menevät puhtaasti." },
    { id: "strength_light", sport: "strength", itype: "strength", cls: "easy", title: "Kevyt voima ja keskivartalo 35 min", min: 35,
      steps: [
        ["Goblet-kyykky", "3 × 10."],
        ["Yhden jalan maastaveto", "3 × 8 / jalka."],
        ["Punnerrus", "3 × 10."],
        ["Kuminauhasoutu", "3 × 12."],
        ["Dead bug ja kylkilankku", "3 × 10 ja 3 × 30 s / puoli."],
      ],
      tip: "Kevyet painot, ei uupumukseen asti. Sopii päivälle, jolloin valmius on kohtalainen." },
    { id: "mobility", sport: "other", itype: "recovery", cls: "recovery", title: "Liikkuvuus ja kehonhuolto 25 min", min: 25, general: true,
      steps: [
        ["Lämmittely 5 min", "Kevyt kävely tai pyöräily."],
        ["Venyttely", "Lonkankoukistajat, pakarat, takareidet, pohkeet ja rintaranka, 2 × 45 s kukin."],
        ["Foam roller 10 min", "Reidet, pohkeet ja yläselkä rauhallisesti."],
      ],
      tip: "Hyvä valinta väsyneenä tai kovan treenipäivän jälkeen." },
    { id: "rest", sport: "other", itype: "recovery", cls: "rest", title: "Lepopäivä", min: 0, general: true, rest: true,
      steps: [
        ["Ei treeniä tänään", "Keho kehittyy palautuessa. Kevyt arkiliikunta on hyväksi, mutta jätä treeni väliin."],
        ["Palautumista tukee", "Riittävä uni (tavoite 8 h), monipuolinen ruoka ja juominen. Halutessasi 10–20 min venyttelyä tai rauhallinen kävely."],
        ["Huomenna", "Tarkista valmius aamulla ennen seuraavaa treeniä."],
      ],
      tip: "Lepopäivä ei ole menetetty päivä: kovien treenien hyöty syntyy vasta, kun keho ehtii palautua niistä." },
    { id: "walk", sport: "other", itype: "recovery", cls: "recovery", title: "Kävely 30–45 min", min: 40, general: true,
      steps: [["Kävely", "Rauhallinen kävely ulkona, syke alueella 1 tai alle."]],
      tip: "Lepo on osa harjoittelua: kehitys tapahtuu palautuessa." },
  ];
}

// Yksittäinen treenipohja kalenteria varten (kesto voidaan antaa minuutteina)
export function templateById(id, { zones, easyPace, minutes } = {}) {
  return templates({ zones, easyPace, minutes }).find(t => t.id === id) || null;
}
export function easyPaceOf(acts, today = new Date()) {
  const runs = acts.filter(a => a.sport === "run" && (a.itype === "base" || a.itype === "recovery") && a.speed && a.dur >= 20 * 60 && a.date >= addDays(today, -60));
  return runs.length >= 2 ? fmtPace(mean(runs.map(a => a.speed))) : null;
}

// ---------- ehdotukset ----------
export function suggestWorkouts({ acts, ready, zones, settings, today = new Date(), planToday = [], trendList = [], share = null, load = null }) {
  const t0 = startOfDay(today);
  const last7 = acts.filter(a => a.date >= addDays(t0, -7) && a.date < t0);
  const last28 = acts.filter(a => a.date >= addDays(t0, -28) && a.date < t0);
  const doneToday = acts.filter(a => a.date >= t0 && a.date < addDays(t0, 1));
  const daysAgo = (a) => Math.round((t0 - startOfDay(a.date)) / 864e5);
  const isHardAct = (a) => HARD.has(a.itype) || (a.anTE != null && a.anTE >= 3);
  const hard7 = last7.filter(isHardAct).length;
  const tempo7 = last7.filter(a => a.itype === "tempo").length;
  const lastHard = [...acts].reverse().find(a => a.date < t0 && isHardAct(a));
  const daysSinceHard = lastHard ? daysAgo(lastHard) : 99;
  const long7 = last7.some(a => (a.sport === "run" && a.dur >= 75 * 60) || (a.sport === "bike" && a.dur >= 110 * 60));
  const strength7 = last7.filter(a => a.sport === "strength" || a.sport === "hyrox").length;
  const lastStrength = [...acts].reverse().find(a => a.date < t0 && (a.sport === "strength" || a.sport === "hyrox"));
  const daysSinceStrength = lastStrength ? daysAgo(lastStrength) : 99;
  const yesterdayHard = last7.some(a => daysAgo(a) === 1 && (isHardAct(a) || a.dur >= 90 * 60));
  const hardToday = doneToday.some(isHardAct);
  const count7 = (sp) => last7.filter(a => a.sport === sp).length;
  const used = new Set([...last28.map(a => a.sport), ...Object.entries(settings?.sessions || {}).filter(([, v]) => v > 0).map(([k]) => k)]);
  const vo2Down = trendList.find(t => t.key === "vo2")?.state === "down";
  const r = ready?.score ?? 60;
  // Peräkkäiset treenipäivät ja eilisen kuorma suhteessa tavalliseen
  let streak = 0;
  for (let i = 1; i <= 7; i++) { const k = dayKey(addDays(t0, -i)); if (acts.some(a => a.day === k)) streak++; else break; }
  const loads28 = last28.map(a => a.load || 0).sort((x, y) => x - y);
  const medLoad = loads28.length ? loads28[Math.floor(loads28.length / 2)] : null;
  const yLoad = acts.filter(a => a.day === dayKey(addDays(t0, -1))).reduce((s, a) => s + (a.load || 0), 0);
  const yBig = medLoad && yLoad >= 1.8 * medLoad;
  const hrvLow = ready?.parts?.hrv && ready.parts.hrv.score < 45;
  const ratioHigh = load?.ratio != null && load.ratio > 1.3;

  // treenirytmi omista treeneistä
  const easyRuns = last28.concat(acts.filter(a => a.date >= addDays(t0, -60) && a.date < addDays(t0, -28)))
    .filter(a => a.sport === "run" && (a.itype === "base" || a.itype === "recovery") && a.speed && a.dur >= 20 * 60);
  const easyPace = easyRuns.length >= 2 ? fmtPace(mean(easyRuns.map(a => a.speed))) : null;
  const easyRunMin = median(easyRuns.filter(a => a.dur < 75 * 60).map(a => a.dur / 60));
  const easyBikeMin = median(acts.filter(a => a.sport === "bike" && a.itype === "base" && a.date >= addDays(t0, -60) && a.dur < 110 * 60).map(a => a.dur / 60));

  const out = [];
  for (const tpl of templates({ zones, easyPace, easyRunMin, easyBikeMin })) {
    if (!tpl.general && !used.has(tpl.sport)) continue;
    let sc = 0;
    const why = [];
    const add = (v, txt) => { sc += v; if (txt && v > 0) why.push([v, txt]); };
    const hard = tpl.cls === "hard";

    // lepopäivä
    if (tpl.rest) {
      if (doneToday.length) continue;
      if (r < 30) add(6, `Valmius on hyvin matala (${r}). Keho kaipaa lepoa.`);
      else if (r < 50) add(2, `Valmius on matala (${r}).`);
      else if (r >= 75) add(-1.5);
      if (streak >= 3) add(streak >= 5 ? 3 : 1.5, `Olet treenannut ${streak} päivää peräkkäin.`);
      if (yBig) add(1.5, `Eilinen kuorma (${Math.round(yLoad)}) oli selvästi tavallista suurempi.`);
      if (hrvLow) add(1.5, "HRV on alle normaalialueesi.");
      if (ratioHigh) add(1.5, `Viikon kuorma on noussut nopeasti (${fmtNum(load.ratio, 2)}× tavallinen).`);
      if (sc < 2.5) continue; // lepoa ehdotetaan vain, kun siihen on selvä syy
      why.sort((a, b) => b[0] - a[0]);
      out.push({ ...tpl, dur: 0, score: sc + 2, why: why.map(w => w[1]) });
      continue;
    }
    // valmius
    if (r < 30) { if (!tpl.general) continue; add(3, `Valmius on hyvin matala (${r}). Kevyt liike on lepoa parempi vain, jos se tuntuu hyvältä.`); }
    else if (r < 50) {
      if (hard || tpl.cls === "long" || tpl.cls === "strength") continue;
      if (tpl.cls === "recovery") add(1.5, `Valmius on matala (${r}), joten kevyt treeni on paras valinta.`);
      if (tpl.cls === "easy") add(1.5, `Valmius on matala (${r}): kevyt aerobinen treeni sopii, kova kannattaa siirtää.`);
    } else {
      if (tpl.cls === "recovery") add(-2);
      if (hard && r >= 75) add(1, `Valmius on korkea (${r}), hyvä päivä kovalle treenille.`);
      if (tpl.itype === "vo2" && r < 65) add(-1);
      if (tpl.itype === "threshold" && r >= 50 && r < 75) add(0.5);
    }
    if (hardToday && (hard || tpl.cls === "long")) continue;
    if (doneToday.length && tpl.cls === "recovery") add(1.5, "Olet jo treenannut tänään, joten lisäksi sopii vain jotain kevyttä.");
    if (doneToday.length && tpl.cls !== "recovery") add(-2);

    // kova treeni
    if (hard) {
      if (yesterdayHard || daysSinceHard < 2) add(-5);
      if (yBig) add(-3);
      if (streak >= 4) add(-1.5);
      if (hard7 === 0) add(3, tempo7 ? "Viimeisen 7 päivän aikana ei yhtään kynnys- tai VO2max-tason treeniä." : "Viimeisen 7 päivän aikana ei yhtään kovaa treeniä.");
      else if (hard7 === 1) add(1, "Vain yksi kova treeni viimeisen 7 päivän aikana.");
      else if (hard7 >= 3) add(-3);
      if (tpl.itype === "vo2" && vo2Down) add(1.5, "VO2max-trendisi on laskeva, ja tämä treeni kehittää sitä suoraan.");
    }
    if (tpl.cls === "long") {
      if (!long7) add(2, "Pitkää peruskestävyystreeniä ei ole tehty 7 päivään.");
      else add(-2);
      if (weekdayIdx(today) === settings?.longDay) add(1.5, "Tänään on asetuksissa valittu pitkän treenin päivä.");
      if (yesterdayHard) add(-1);
      if (yBig) add(-2.5);
    }
    if ((tpl.sport === "strength" || tpl.sport === "hyrox") && tpl.cls !== "easy" && (yBig || yesterdayHard)) add(-2);
    if (tpl.cls === "easy" && tpl.sport !== "strength" && yBig) add(1.5, "Eilinen oli raskas, joten tänään kevyt aerobinen treeni tukee palautumista.");
    if (tpl.sport === "strength" || tpl.sport === "hyrox") {
      if (strength7 === 0) add(2.5, "Voimaharjoittelua ei ole tehty 7 päivään.");
      else if (daysSinceStrength >= 3) add(1, `Edellisestä voimatreenistä on ${daysSinceStrength} päivää.`);
      else if (daysSinceStrength <= 1) add(-2);
      if (tpl.hyrox && /hyrox/i.test(JSON.stringify(settings?.goal || "")) ) add(1, "Tavoitteesi on HYROX-tapahtuma.");
    }
    if (tpl.cls === "easy" && tpl.sport !== "strength" && tpl.sport !== "hyrox") {
      add(1);
      if (share && share.easy < 0.65) add(1, `Kevyen treenin osuus on vain ${Math.round(share.easy * 100)} %, peruskestävyyttä kaivataan lisää.`);
      if (yesterdayHard) add(1.5, "Eilinen oli raskas, joten tänään kevyt aerobinen treeni tukee palautumista.");
    }
    // lajien tasapaino suhteessa viikkotavoitteeseen
    const target = settings?.sessions?.[tpl.sport] || 0;
    if (!tpl.general && target > 0) {
      const done = count7(tpl.sport);
      const deficit = target - done;
      if (deficit > 0) add(0.8 * deficit, `${SPORTS[tpl.sport].name}: ${done}/${target} treeniä viimeisen 7 päivän aikana.`);
      else if (deficit < 0) add(0.5 * deficit);
    }
    // kalenteri
    if (planToday.some(p => p.sport === tpl.sport && p.kind !== "event")) add(1, "Kalenterissasi on tälle päivälle tämän lajin treeni.");

    why.sort((a, b) => b[0] - a[0]);
    out.push({ ...tpl, dur: tpl.min * 60, score: sc, why: why.map(w => w[1]) });
  }

  // kolme parasta, eri lajeja ja tyyppejä suosien
  const picked = [];
  const pool = [...out];
  while (picked.length < 6 && pool.length) {
    pool.sort((a, b) => b.score - a.score);
    const p = pool.shift();
    picked.push(p);
    for (const q of pool) {
      if (q.sport === p.sport) q.score -= 1.5;
      if (q.cls === p.cls) q.score -= q.cls === "hard" ? 4 : 1;
      if (q.itype === p.itype) q.score -= 1;
      if (q.hyrox && p.hyrox) q.score -= 2;
    }
  }
  for (const p of picked) if (!p.why.length) p.why = ["Monipuolistaa viikkoa."];
  return { list: picked, stats: { hard7, daysSinceHard, strength7, long7, r } };
}

// ---------- viimeisimmän treenin analyysi ----------
function eff(a) {
  const n = hrNorm(a);
  return n ? n.y : null;
}

export function similarActs(a, acts) {
  const from = addDays(a.date, -120);
  const base = acts.filter(x => x.id !== a.id && x.sport === a.sport && x.date < a.date && x.date >= from);
  let sim = base.filter(x => x.itype === a.itype);
  if (a.dist > 0) {
    const byDist = sim.filter(x => x.dist > 0 && Math.abs(x.dist - a.dist) / a.dist <= 0.35);
    if (byDist.length >= 2) sim = byDist;
  } else {
    const byDur = sim.filter(x => Math.abs(x.dur - a.dur) / (a.dur || 1) <= 0.35);
    if (byDur.length >= 2) sim = byDur;
  }
  return sim.slice(-10);
}

export function compareActivity(a, acts) {
  const sim = similarActs(a, acts);
  if (!sim.length) return { n: 0 };
  const avg = (f) => mean(sim.map(f).filter(v => v != null && isFinite(v)));
  const rows = [];
  const row = (label, cur, av, fmt, higherBetter, tol = 0.01) => {
    if (cur == null || av == null) return;
    const d = av ? (cur - av) / Math.abs(av) : 0;
    const better = higherBetter === null ? "n" : Math.abs(d) < tol ? null : higherBetter ? d > 0 : d < 0;
    rows.push({ label, cur: fmt(cur), avg: fmt(av), better, diff: d });
  };
  if (a.sport === "run") {
    row("Vauhti", a.speed, avg(x => x.speed), fmtPace, true);
    row("Keskisyke", a.avgHR, avg(x => x.avgHR), (v) => `${Math.round(v)}`, false, 0.015);
    row(`Vauhti sykkeellä ${HR_REF.run}`, eff(a), avg(eff), fmtPace, true);
    row("Matka", a.dist || null, avg(x => x.dist || null), fmtKm, null);
  } else if (a.sport === "bike") {
    if (a.power) row("Keskiteho", a.power, avg(x => x.power), (v) => `${Math.round(v)} W`, true);
    else row("Keskinopeus", a.speed, avg(x => x.speed), (v) => `${fmtNum(v * 3.6, 1)} km/h`, true);
    row("Keskisyke", a.avgHR, avg(x => x.avgHR), (v) => `${Math.round(v)}`, false, 0.015);
    { const u = hrNorm(a)?.unit; if (u) row(`${u === "W" ? "Teho" : "Nopeus"} sykkeellä ${HR_REF.bike}`, eff(a), avg(x => hrNorm(x)?.unit === u ? eff(x) : null), (v) => fmtNorm(v, u), true); }
  } else {
    row("Kesto", a.dur, avg(x => x.dur), fmtDur, null);
    row("Keskisyke", a.avgHR, avg(x => x.avgHR), (v) => `${Math.round(v)}`, false, 0.015);
    row("Kuorma", a.load, avg(x => x.load), (v) => fmtNum(v), true, 0.05);
    if (a.sets) row("Sarjat", a.sets, avg(x => x.sets), (v) => fmtNum(v), true, 0.05);
  }
  let verdict = "Treeni oli linjassa aiempien vastaavien kanssa.";
  const e = eff(a), ea = avg(eff);
  if (e != null && ea != null) {
    const d = (e - ea) / ea;
    const all = [...sim.map(eff).filter(v => v != null), e].sort((x, y) => y - x);
    const rank = all.indexOf(e) + 1;
    if (d > 0.02) verdict = `Kulku oli parempi kuin vastaavissa treeneissä: ${Math.round(d * 100)} % enemmän vauhtia suhteessa sykkeeseen. ${rank === 1 ? "Paras tulos viimeisen 4 kuukauden vastaavista." : `${rank}. paras ${all.length}:stä vastaavasta.`}`;
    else if (d < -0.02) verdict = `Tällä kertaa raskaampi kuin yleensä: ${Math.abs(Math.round(d * 100))} % vähemmän vauhtia suhteessa sykkeeseen. Syynä voi olla väsymys, lämpö, tuuli tai maasto.`;
    else verdict = "Vauhti suhteessa sykkeeseen oli samaa tasoa kuin vastaavissa treeneissä.";
  } else if (a.load != null) {
    const la = avg(x => x.load);
    if (la) {
      const d = (a.load - la) / la;
      if (d > 0.15) verdict = `Tavallista kuormittavampi kuin vastaavat treenit (+${Math.round(d * 100)} % kuormaa).`;
      else if (d < -0.15) verdict = `Kevyempi kuin vastaavat treenit (${Math.round(d * 100)} % kuormaa).`;
    }
  }
  return { n: sim.length, rows, verdict, label: `${ITYPES[a.itype]?.name || ""}${a.dist ? `, ${fmtKm(a.dist)} ± 35 %` : ""}` };
}

export function analyzeActivity(a, acts) {
  const f = [];
  if (a.zones) {
    const t = a.zones.reduce((s, v) => s + v, 0) || 1;
    const p = a.zones.map(v => v / t);
    const top = p.indexOf(Math.max(...p));
    const hard = p[3] + p[4];
    f.push(`Suurin osa ajasta (${Math.round(p[top] * 100)} %) oli alueella ${top + 1}${hard >= 0.15 ? `, ja ${Math.round(hard * 100)} % kovilla alueilla 4–5` : ""}. Treeni luokiteltiin tyypiksi ${ITYPES[a.itype].name.toLowerCase()}.`);
  } else if (!a.manual) f.push(`Treeni luokiteltiin tyypiksi ${ITYPES[a.itype].name.toLowerCase()}.`);
  if (a.aeTE != null) {
    const te = a.aeTE;
    const txt = te < 1 ? "ei juuri harjoitusvaikutusta" : te < 2 ? "palauttava, ylläpitää kuntoa" : te < 3 ? "ylläpitää aerobista kuntoa" : te < 4 ? "parantaa aerobista kuntoa" : te < 5 ? "kehittää aerobista kuntoa merkittävästi" : "ylikuormittava, vaatii pitkän palautumisen";
    f.push(`Aerobinen Training Effect ${fmtNum(te, 1)}: ${txt}.${a.anTE != null && a.anTE >= 2 ? ` Anaerobinen ${fmtNum(a.anTE, 1)}: ${a.anTE >= 3 ? "kehitti selvästi vauhtikestävyyttä ja kovaa tehoa" : "jonkin verran anaerobista harjoitusta"}.` : ""}`);
  }
  const same = acts.filter(x => x.sport === a.sport && x.id !== a.id && x.date >= addDays(a.date, -60) && x.date < a.date && x.load);
  const ml = median(same.map(x => x.load));
  if (ml && a.load) {
    const ratio = a.load / ml;
    const txt = ratio > 1.4 ? `selvästi tavallista raskaampi (${fmtNum(ratio, 1)}× tavallinen)` : ratio > 1.1 ? "hieman tavallista raskaampi" : ratio < 0.7 ? "tavallista kevyempi" : "tavanomainen";
    f.push(`Kuorma ${fmtNum(a.load)} oli lajin treeneistäsi ${txt}.`);
  }
  const hard = HARD.has(a.itype) || (a.anTE ?? 0) >= 3 || (a.aeTE ?? 0) >= 4 || a.dur >= 100 * 60;
  f.push(hard ? "Anna noin 48 tuntia ennen seuraavaa kovaa treeniä. Kevyt liikunta välissä on hyväksi." : "Kevyt tai kohtalainen treeni: ei estä huomista harjoittelua.");
  return { findings: f, cmp: compareActivity(a, acts), laps: lapAnalysis(a) };
}


// ---------- kierrokset (FIT) ----------
// HYROX: kierrokset jaetaan juoksuihin (matka ≥ 400 m ja vauhti juoksua) ja asemiin.
export function lapAnalysis(a) {
  const laps = a.laps;
  if (!laps || laps.length < 2) return null;
  const rows = laps.map((l, i) => {
    const speed = l.d && l.t ? l.d / l.t : null;
    const isRun = (a.sport === "hyrox" || a.sport === "strength") ? (l.d >= 400 && speed > 1.8) : null;
    return { i: i + 1, ...l, speed, isRun };
  });
  const out = { rows, notes: [] };
  if (a.sport === "hyrox" || a.sport === "strength") {
    const runs = rows.filter(r => r.isRun);
    const stations = rows.filter(r => r.isRun === false);
    out.runs = runs; out.stations = stations;
    if (runs.length >= 2) {
      const first = runs[0], lastR = runs[runs.length - 1];
      const slow = 1000 / lastR.speed - 1000 / first.speed;
      const avgAfter = mean(runs.slice(1).map(r => 1000 / r.speed));
      out.notes.push(`Juoksuja ${runs.length}, keskivauhti ${fmtPace(mean(runs.map(r => r.speed)))}. Ensimmäinen ${fmtPace(first.speed)}, viimeinen ${fmtPace(lastR.speed)} (${slow >= 0 ? "+" : "−"}${Math.abs(Math.round(slow))} s/km).`);
      if (avgAfter) {
        const d = avgAfter - 1000 / first.speed;
        out.notes.push(d > 20 ? `Juoksu hidastui asemien jälkeen keskimäärin ${Math.round(d)} s/km. Compromised running -treeni (juoksu heti aseman perään) auttaa tähän.` : d > 0 ? `Juoksu hidastui asemien jälkeen vain ${Math.round(d)} s/km. Hyvä kestävyys väsyneillä jaloilla.` : "Juoksuvauhti pysyi tasaisena koko treenin ajan.");
      }
    }
    if (stations.length) out.notes.push(`Asemia/muita osuuksia ${stations.length}, yhteensä ${fmtDur(stations.reduce((s2, r) => s2 + (r.t || 0), 0))}.`);
    if (!runs.length) out.notes.push("Juoksuosuuksia ei tunnistettu kierroksista. Paina lap-nappia jokaisen juoksun ja aseman vaihtuessa, niin sivu erottaa ne.");
  } else if (a.sport === "run" && rows.length >= 3) {
    const sp = rows.filter(r => r.d >= 200 && r.speed).map(r => 1000 / r.speed);
    if (sp.length >= 3) {
      const half = Math.floor(sp.length / 2);
      const d = mean(sp.slice(half)) - mean(sp.slice(0, half));
      out.notes.push(Math.abs(d) < 5 ? "Tasainen vauhti koko lenkin ajan." : d < 0 ? `Negatiivinen splitti: jälkimmäinen puolisko ${Math.round(-d)} s/km nopeampi.` : `Vauhti hiipui loppua kohti ${Math.round(d)} s/km.`);
    }
  }
  return out;
}

// ---------- juoksuennätykset (FIT-tiedostoista) ----------
export const PB_DIST = [["1000", "1 km"], ["5000", "5 km"], ["10000", "10 km"], ["21097", "Puolimaraton"], ["42195", "Maraton"]];
export function personalBests(acts, from = null) {
  const out = {};
  for (const a of acts) {
    if (a.sport !== "run" || !a.best || (from && a.date < from)) continue;
    for (const [k] of PB_DIST) {
      const t = a.best[k];
      if (t && (!out[k] || t < out[k].t)) out[k] = { t, a };
    }
  }
  return out;
}
export const fmtTime = (s) => {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

// ---------- viikkokatsaus ----------
export function weekReview(acts, health, planFor, ws) {
  const we = addDays(ws, 7);
  const wa = acts.filter(a => a.date >= ws && a.date < we);
  const sum = (arr, f) => arr.reduce((s2, x) => s2 + (f(x) || 0), 0);
  const prev = [1, 2, 3, 4].map(i => acts.filter(a => a.date >= addDays(ws, -7 * i) && a.date < addDays(ws, -7 * (i - 1))));
  const prevLoad = mean(prev.map(w => sum(w, a => a.load)));
  const prevDur = mean(prev.map(w => sum(w, a => a.dur)));
  const dur = sum(wa, a => a.dur), load = sum(wa, a => a.load);
  const z = [0, 0, 0, 0, 0];
  for (const a of wa) if (a.zones) a.zones.forEach((v, i) => (z[i] += v));
  const zt = z.reduce((x, y) => x + y, 0);
  const bySport = {};
  for (const a of wa) { const b = (bySport[a.sport] = bySport[a.sport] || { n: 0, dur: 0, dist: 0 }); b.n++; b.dur += a.dur; b.dist += a.dist; }
  const plan = planFor(ws);
  const plannedN = plan.days.reduce((s2, d) => s2 + d.items.filter(i => i.kind !== "event").length, 0);
  const doneN = plan.days.reduce((s2, d) => s2 + d.items.filter(i => i.done).length, 0);
  const hk = (d) => dayKey(d);
  const hw = health.filter(d => d.day >= hk(ws) && d.day < hk(we));
  const hp = health.filter(d => d.day >= hk(addDays(ws, -28)) && d.day < hk(ws));
  const avgF = (arr, f) => mean(arr.map(d => d[f]).filter(v => v != null));
  const longest = wa.reduce((m, a) => (a.dur > (m?.dur || 0) ? a : m), null);
  const hardest = wa.reduce((m, a) => (a.load > (m?.load || 0) ? a : m), null);
  const notes = [];
  if (prevLoad) {
    const r = load / prevLoad;
    notes.push(r > 1.25 ? `Kuorma oli ${Math.round((r - 1) * 100)} % edellisten viikkojen keskiarvoa suurempi. Huolehdi palautumisesta.` : r < 0.75 ? `Kuorma oli ${Math.round((1 - r) * 100)} % tavallista pienempi.` : "Kuorma oli tavallisella tasolla.");
  }
  if (zt) {
    const easy = (z[0] + z[1]) / zt;
    notes.push(easy >= 0.75 ? `Intensiteettijakauma hyvä: ${Math.round(easy * 100)} % kevyttä.` : `Kevyttä vain ${Math.round(easy * 100)} %. Tavoite kestävyyslajeissa on noin 80 %.`);
  }
  if (plannedN) notes.push(`Kalenteriin itse lisätyistä treeneistä toteutui ${doneN}/${plannedN}.`);
  const hrvW = avgF(hw, "hrv"), hrvP = avgF(hp, "hrv");
  if (hrvW && hrvP) notes.push(`HRV keskimäärin ${Math.round(hrvW)} ms (edelliset 4 vk ${Math.round(hrvP)} ms).`);
  const sl = avgF(hw, "sleepSec");
  if (sl) notes.push(`Unta keskimäärin ${fmtNum(sl / 3600, 1)} h yössä.`);
  return { ws, n: wa.length, dur, load, prevDur, prevLoad, bySport, z, zt, plannedN, doneN, longest, hardest, notes, week: isoWeekNum(ws) };
}

// ---------- kuukausi- ja vuosisummat ----------
export function totals(acts, today = new Date()) {
  const m0 = new Date(today.getFullYear(), today.getMonth(), 1);
  const pm0 = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const y0 = new Date(today.getFullYear(), 0, 1);
  const agg = (from, to) => {
    const r = {};
    for (const k of [...SPORT_KEYS, "all"]) r[k] = { n: 0, dur: 0, dist: 0 };
    for (const a of acts) if (a.date >= from && a.date < to) for (const k of [a.sport, "all"]) { r[k].n++; r[k].dur += a.dur; r[k].dist += a.dist; }
    return r;
  };
  const end = addDays(startOfDay(today), 1);
  return { month: agg(m0, end), prevMonth: agg(pm0, m0), year: agg(y0, end), monthName: today.toLocaleDateString("fi-FI", { month: "long" }), prevMonthName: pm0.toLocaleDateString("fi-FI", { month: "long" }), year0: today.getFullYear() };
}

// ---------- juoksun dynamiikka ----------
// Vertailualueet Garminin juoksijajakauman mukaan (5 = paras). Askelpituudelle ei ole yleistä aluetta.
export const DYN = [
  { k: "cad", name: "Askeltiheys", unit: "askelta/min", fmt: (v) => fmtNum(v, 0), higher: true, bands: [153, 164, 174, 184],
    tipLow: "Askeltiheys on matala. Lyhyempi ja nopeampi askel (+5 % kerrallaan) vähentää jarruttamista ja rasitusta polville." },
  { k: "gct", name: "Maakosketusaika", unit: "ms", fmt: (v) => fmtNum(v, 0), higher: false, bands: [308, 277, 248, 218],
    tipLow: "Maakosketus on pitkä. Mäkivedot, hyppelyt ja nopeat rennot vedot opettavat jalkaa ponnistamaan nopeammin." },
  { k: "vo", name: "Pystyliike", unit: "cm", fmt: (v) => fmtNum(v, 1), higher: false, bands: [11.5, 9.7, 8.1, 6.4],
    tipLow: "Kehon pystyliike on suuri: energiaa kuluu pomppimiseen. Ajattele eteenpäin liikkumista ylöspäin ponnistamisen sijaan." },
  { k: "vr", name: "Pystysuhde", unit: "%", fmt: (v) => fmtNum(v, 1), higher: false, bands: [10.1, 8.6, 7.4, 6.1],
    tipLow: "Pystysuhde (pystyliike suhteessa askelpituuteen) on korkea. Mitä pienempi, sitä taloudellisempi juoksu." },
  { k: "bal", name: "Maakosketuksen tasapaino", unit: "% vasen", fmt: (v) => `${fmtNum(v, 1)} / ${fmtNum(100 - v, 1)}`, balance: true,
    tipLow: "Vasemman ja oikean jalan ero on yli 1,5 %. Pysyvä epätasapaino voi kertoa lihasepätasapainosta tai vanhasta vammasta: yhden jalan voimaliikkeet auttavat." },
  { k: "stride", name: "Askelpituus", unit: "m", fmt: (v) => fmtNum(v, 2), higher: true, bands: null },
];
// Palauttaa tason 1–5 (5 = paras) tai null
export function dynLevel(m, v) {
  if (v == null) return null;
  if (m.balance) { const d = Math.abs(v - 50); return d <= 0.7 ? 5 : d <= 1.4 ? 3 : 1; }
  if (!m.bands) return null;
  const b = m.bands;
  if (m.higher) return v < b[0] ? 1 : v < b[1] ? 2 : v < b[2] ? 3 : v < b[3] ? 4 : 5;
  return v > b[0] ? 1 : v > b[1] ? 2 : v > b[2] ? 3 : v > b[3] ? 4 : 5;
}
export const DYN_LEVEL = { 1: "Heikko", 2: "Kohtalainen", 3: "Hyvä", 4: "Erinomainen", 5: "Huippu" };

// Oma keskiarvo ja kehitys: viimeiset 4 viikkoa vs. sitä edeltävät 12 viikkoa
export function dynSummary(acts, today = new Date()) {
  const runs = acts.filter(a => a.sport === "run" && a.dyn);
  if (!runs.length) return null;
  const r4 = addDays(today, -28), r16 = addDays(today, -112);
  const out = {};
  for (const m of DYN) {
    const pts = runs.filter(a => a.dyn[m.k] != null).map(a => ({ x: a.date, y: a.dyn[m.k], a }));
    if (!pts.length) continue;
    const recent = mean(pts.filter(p => p.x >= r4).map(p => p.y));
    const base = mean(pts.filter(p => p.x < r4 && p.x >= r16).map(p => p.y));
    out[m.k] = { m, pts, recent, base, latest: pts[pts.length - 1].y };
  }
  return { runs: runs.length, metrics: out };
}
