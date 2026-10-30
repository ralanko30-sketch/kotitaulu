// Yhteinen laskenta: käytetään sekä selaimessa (app.js) että kalenteritilauksessa (Netlify-funktio).
import {
  normActivity, normHealth, readiness, loadStatus, trends, intensityShare, alerts, defaultSettings, normalizeSettings,
  buildPlan, manualActivities, parseHrZones, weekStart, addDays, dayKey, setSportMap, HR_REF, hrReference, phaseInfo,
} from "./model.js";
import { suggestWorkouts, vo2Data, fitnessAgeInfo, templateById, easyPaceOf } from "./insights.js";

export function computeState(raw, today = new Date()) {
  const S = { raw, today };
  const settings0 = raw.settings ? normalizeSettings(raw.settings) : null;
  setSportMap(settings0?.sportMap || {});
  S.plan = raw.plan && Array.isArray(raw.plan.items) ? raw.plan : { items: [], hidden: [] };
  S.plan.hidden = S.plan.hidden || [];
  const all = Object.values(raw.activities || {}).map(normActivity).filter(a => !isNaN(a.date));
  S.excluded = all.filter(a => a.sport === "exclude").length;
  const garmin = all.filter(a => a.sport !== "exclude");
  S.acts = [...garmin, ...manualActivities(S.plan.items, garmin, today)].sort((a, b) => a.date - b.date);
  S.typeKeys = [...new Set(all.map(a => a.typeKey))].sort();
  S.health = normHealth(raw.healthByDate || {}, raw.fitnessAge || null);
  Object.assign(HR_REF, hrReference(S.acts, S.health, today));
  S.hrZones = parseHrZones(raw.hrZones);
  S.settings = settings0 || defaultSettings(S.acts, today);
  S.load = loadStatus(S.acts, today);
  S.ready = readiness(S.health, S.acts, S.load, today);
  S.trends = trends(S.acts, S.health, today, raw.vo2History || {});
  S.share = intensityShare(S.acts, 28, today);
  S.alerts = alerts(S.trends, S.load, S.share, S.ready);
  S.ctx = { acts: S.acts, settings: S.settings, alertList: S.alerts, load: S.load, ready: S.ready, share: S.share, today, manual: S.plan.items, hidden: S.plan.hidden };
  const cache = new Map();
  S.planFor = (ws) => {
    const k = +ws;
    if (!cache.has(k)) cache.set(k, buildPlan({ ...S.ctx, weekStartDate: ws }));
    return cache.get(k);
  };
  S.planNow = S.planFor(weekStart(today));
  S.planNext = S.planFor(addDays(weekStart(today), 7));
  const todayPlan = S.planNow.days.find(d => dayKey(d.date) === dayKey(today));
  S.todayPlan = todayPlan;
  S.sugg = suggestWorkouts({ acts: S.acts, ready: S.ready, zones: S.hrZones, settings: S.settings, today,
    planToday: todayPlan?.items || [], trendList: S.trends, share: S.share, load: S.load });
  S.latest = [...S.acts].reverse().find(a => a.date <= new Date()) || null;
  S.vo2 = vo2Data(S.acts, today, raw.vo2History || {});
  S.fitAge = fitnessAgeInfo(raw.fitnessAge);
  S.phase = phaseInfo(S.settings.events, today);
  S.easyPace = easyPaceOf(S.acts, today);
  // Kalenterin treenin tarkka sisältö
  S.sessionDetail = (it) => {
    if (!it.tpl) return null;
    const cls = templateById(it.tpl, { zones: S.hrZones, easyPace: S.easyPace });
    const base = templateById(it.tpl, { zones: S.hrZones, easyPace: S.easyPace, minutes: Math.round((it.dur || 0) / 60) });
    return ["easy", "long", "recovery"].includes(cls?.cls) ? base : cls;
  };
  return S;
}
