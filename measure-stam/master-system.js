'use strict';

/*
 * The professional language shared by every Medidaot surface.
 * One semantic registry drives the menu, overlay, label, result and data file.
 * It intentionally contains no pass/fail thresholds that the teacher has not
 * defined yet.
 */
globalThis.MEDIDAOT_MASTER_SYSTEM = (() => {
  const GROUPS = Object.freeze([
    Object.freeze({
      id: 'regaim',
      name: 'רגעים',
      summary: 'רוחבים · גבהים · עובי קולמוס · ישרות · משקלים ומרווחים',
      entries: Object.freeze([
        Object.freeze({ letter: 'ר', metricIds: Object.freeze(['widths']) }),
        Object.freeze({ letter: 'ג', metricIds: Object.freeze(['heights']) }),
        Object.freeze({ letter: 'ע', metricIds: Object.freeze(['nib']) }),
        Object.freeze({ letter: 'י', metricIds: Object.freeze(['straightness']) }),
        Object.freeze({ letter: 'ם', metricIds: Object.freeze(['weights', 'gaps']) })
      ])
    }),
    Object.freeze({
      id: 'aman',
      name: 'אמן',
      summary: 'איזון לובן · מרכז אופטי ומרפסות · נטיות · מקבילות',
      entries: Object.freeze([
        Object.freeze({ letter: 'א', metricIds: Object.freeze(['white-balance']) }),
        Object.freeze({ letter: 'מ', metricIds: Object.freeze(['optical-center', 'balconies']) }),
        Object.freeze({ letter: 'ן', metricIds: Object.freeze(['slants', 'parallels']) })
      ])
    })
  ]);

  // The weight scale records a professional classification at the point
  // where a thigh leaves its roof.  Two points (12:32) are the Bet baseline
  // and represent approximately a quarter nib; four points are approximately
  // half a nib.  It is intentionally not inferred from a free pixel length.
  const WEIGHT_STEPS = Object.freeze([
    Object.freeze({ points: 1, clockLabel: '12:31', nibFractionApprox: 1 / 8, fractionLabel: '⅛' }),
    Object.freeze({ points: 2, clockLabel: '12:32', nibFractionApprox: 1 / 4, fractionLabel: '¼', betBaseline: true }),
    Object.freeze({ points: 3, clockLabel: '12:33', nibFractionApprox: 3 / 8, fractionLabel: '⅜' }),
    Object.freeze({ points: 4, clockLabel: '12:34', nibFractionApprox: 1 / 2, fractionLabel: '½' })
  ]);

  const METRICS = Object.freeze([
    Object.freeze({
      id: 'widths', name: 'רוחבים', group: 'regaim', color: '#2563eb',
      description: 'בדיקת רוחב האות והלובן הפנימי ביחס למשפחת האותיות. כללי הרוחב היחיד והחריגה יוגדרו בהמשך.',
      measurementDescription: 'מסמנים שתי נקודות לרוחב הנבדק. האפליקציה שומרת את ערך הפיקסלים ומציגה אותו ביחידות עובי קולמוס כאשר קיים כיול.',
      tool: 'length', category: 'width', axisConstraint: 'horizontal', operationMode: 'manual', operationLabel: 'קו רוחב אופקי · ללא השוואת משפחה'
    }),
    Object.freeze({
      id: 'heights', name: 'גבהים', group: 'regaim', color: '#059669',
      description: 'בדיקת גובה האות או האיבר ביחס לשורה ולמשפחת האותיות.',
      measurementDescription: 'מסמנים שתי נקודות לאורך הגובה הנבדק. הקו ננעל לציר אנכי; ההשוואה למשפחת אותיות תופעל רק לאחר שיוגדרו כללי המשפחה.',
      tool: 'length', category: 'height', axisConstraint: 'vertical', operationMode: 'manual', operationLabel: 'קו גובה אנכי · ללא השוואת משפחה'
    }),
    Object.freeze({
      id: 'nib', name: 'עובי קולמוס', group: 'regaim', color: '#7c3aed',
      description: 'יחידת היסוד הנמדדת מעובי קו מייצג. יתר האורכים והמרווחים מוצגים ביחידות עובי קולמוס.',
      measurementDescription: 'המערכת מאתרת גגות ישרים בתמונה או מקבלת קו ידני מאומת. כיול ידני נשאר נעול עד שהמשתמש משנה אותו.',
      tool: 'nib', category: 'nib', operationMode: 'assisted', operationLabel: 'זיהוי אוטומטי + אימות ידני'
    }),
    Object.freeze({
      id: 'straightness', name: 'ישרות', group: 'regaim', color: '#0f766e',
      description: 'קו ייחוס לתחתית מושבים יציבים. ב׳, כ׳ ונ׳ רגילה משמשות מועמדות; ן׳ סופית וי׳ אינן משמשות לקביעת הקו.',
      measurementDescription: 'מסמנים שורה, מאשרים אילו מושבים שייכים לב׳, כ׳ או נ׳ רגילה, ורק אז נקבע קו לפי המושב הנמוך ביותר. יתר המושבים נמדדים ביחס אליו.',
      tool: 'rowAlign', category: 'straightness', operationMode: 'assisted', operationLabel: 'סריקה + סיווג אנושי'
    }),
    Object.freeze({
      id: 'weights', name: 'משקלים', group: 'regaim', color: '#ca8a04',
      description: 'דיגום הדומיננטיות במקום יציאת הירך מן הגג בדרגות 1–4: 12:31 עד 12:34. שתי נקודות הן בסיס האות ב׳.',
      measurementDescription: 'בוחרים דרגה ונוגעים בנקודת יציאת הירך מן הגג. הסימון נשמר כ־1–4 נקודות; שתי נקודות הן בקירוב רבע קולמוס וארבע נקודות בקירוב חצי קולמוס.',
      tool: 'weightSample', category: 'weight', operationMode: 'manual', operationLabel: 'נקודת יציאה מן הגג · דרגות 1–4'
    }),
    Object.freeze({
      id: 'gaps', name: 'מרווחים', group: 'regaim', color: '#0891b2',
      description: 'בדיקת המרווחים בתוך האות, בין אותיות, בין מילים ובין השיטין ביחידות עובי קולמוס.',
      measurementDescription: 'בוחרים את סוג המרווח ומסמנים את גבולותיו. בין השיטין ניתן לזיהוי אוטומטי מתחתית הדיו של השורה העליונה עד ראש השורה הבאה.',
      tool: 'gap', category: 'letter-gap', formulaKey: 'common-gap', operationMode: 'mixed', operationLabel: 'ידני · בין השיטין גם אוטומטי'
    }),
    Object.freeze({
      id: 'white-balance', name: 'איזון לובן', group: 'aman', color: '#e11d48',
      description: 'השוואת שטחי הלובן והיחסים ביניהם בתוך האות ובין האותיות.',
      measurementDescription: 'מקיפים כל תחום לובן במסלול סגור. האפליקציה מחשבת שטח ושומרת אותו להשוואה לתחומים אחרים.',
      tool: 'area', category: 'white-space', operationMode: 'manual', operationLabel: 'שטח פוליגון · ללא כלל איזון'
    }),
    Object.freeze({
      id: 'optical-center', name: 'מרכז אופטי', group: 'aman', color: '#9333ea',
      description: 'נקודת האיזון החזותית של האות בתוך הקעסטעל. דרך המדידה המדויקת תוגדר בהמשך.',
      measurementDescription: 'בשלב זה זהו ערך מידע בלבד. לא נקבע אלגוריתם מספרי ולכן האפליקציה אינה מציגה כלי מדידה פעיל.',
      tool: null, category: 'optical-center', operationMode: 'information', operationLabel: 'מידע בלבד · אין אלגוריתם'
    }),
    Object.freeze({
      id: 'balconies', name: 'מרפסות', group: 'aman', color: '#ea580c',
      description: 'מדידת הבליטה של המרפסת. בשלב זה משווים ערך מספרי בין ו׳ לת׳ בלי לקבוע עדיין מהי חריגה.',
      measurementDescription: 'מסמנים את רוחב הבליטה בשתי נקודות ומסווגים את המדידה כו׳ או ת׳. כל מופע וערכו נשמרים בנפרד, ולצדם מוצגים חציון והפרש ללא סיווג תקין או חריג.',
      tool: 'gap', category: 'balcony', formulaKey: 'balcony-width', operationMode: 'manual', operationLabel: 'שתי נקודות + השוואת חציונים'
    }),
    Object.freeze({
      id: 'slants', name: 'נטיות', group: 'aman', color: '#0284c7',
      description: 'מדידת נטיית הירך הימנית על גבול הלובן הפנימי, ולא על ציר מרכז הדיו.',
      measurementDescription: 'סריקה של כל התמונה מאתרת ירך ימנית המחוברת לגג ומודדת את הקו השקוף שעל שפת הלובן הפנימי. אפשר גם לסרוק תחום ממוקד ולסווג כל מועמד כד׳, ה׳, ת׳ או „לא לכלול”.',
      tool: 'angle', category: 'slant', operationMode: 'assisted', operationLabel: 'קו לובן פנימי · סריקה + סיווג אנושי'
    }),
    Object.freeze({
      id: 'parallels', name: 'מקבילות', group: 'aman', color: '#6d28d9',
      description: 'בדיקת ההקבלה בין שני גבולות הלובן הפנימי בתוך אותה אות.',
      measurementDescription: 'מסמנים בתוך אותה אות שני קווים שקופים: שתי נקודות לאורך הגבול הראשון ושתי נקודות לאורך הגבול שמולו. האפליקציה מציגה את שתי הזוויות ואת ההפרש ביניהן, ללא קביעת תקין או חריג.',
      tool: 'parallelCheck', category: 'parallel', operationMode: 'guided', operationLabel: 'ארבע נקודות באותה אות · הפרש זוויות'
    }),
    Object.freeze({
      id: 'thirds', name: 'חוק השלישים', group: 'reference', color: '#16a34a',
      description: 'חלוקת רוחב הקעסטעל לשלושה טורים לצורך בדיקת מיקום האיברים בתוך מסגרת האות.',
      measurementDescription: 'יוצרים או בוחרים קעסטעל ומפעילים את רשת השלישים. נקודה מסומנת מקבלת מיקום יחסי בתוך המסגרת.',
      tool: 'thirds', category: 'thirds', operationMode: 'guided', operationLabel: 'כלי ייחוס פעיל'
    }),
    Object.freeze({
      id: 'roof-seat', name: 'מרווח גג–מושב', group: 'reference', color: '#0d9488',
      description: 'המרחק מן הגבול התחתון של הגג עד הגבול העליון של המושב, ביחידות עובי קולמוס.',
      measurementDescription: 'כאשר גבולות הגג והמושב מזוהים בקעסטעל, האפליקציה מפיקה את המרווח ישירות. אחרת ניתן לסמן את שני הגבולות ידנית.',
      tool: 'gap', category: 'letter-gap', formulaKey: 'roof-seat', operationMode: 'mixed', operationLabel: 'זיהוי בקעסטעל או סימון ידני'
    }),
    Object.freeze({
      id: 'circle-ellipse', name: 'עיגול ואליפסה', group: 'reference', color: '#4f46e5',
      description: 'מסגרת גאומטרית פעילה למדידת רוחב, גובה ושטח של עיגול או אליפסה.',
      measurementDescription: 'גוררים מסגרת סביב הצורה. עיגול נשמר ביחס שווה, ואליפסה שומרת רוחב וגובה נפרדים.',
      tool: 'ellipse', category: 'geometry', operationMode: 'manual', operationLabel: 'מסגרת גאומטרית פעילה'
    }),
    Object.freeze({
      id: 'roofs', name: 'גגות', group: 'reference', color: '#be185d',
      description: 'סימון הגג או גבולותיו כמרכיב מבני נפרד של האות.',
      measurementDescription: 'זהו תיוג בלבד: בוחרים סימון קיים ומשייכים לו קטגוריית גג במאפייני הסימון. הכרטיס אינו מפעיל כלי זיהוי או מדידה.',
      tool: null, category: 'roof', operationMode: 'label-only', operationLabel: 'תיוג בלבד · לא כלי זיהוי'
    }),
    Object.freeze({
      id: 'seats', name: 'מושבים', group: 'reference', color: '#0369a1',
      description: 'סימון המושב או גבולותיו כמרכיב מבני נפרד של האות.',
      measurementDescription: 'זהו תיוג בלבד: בוחרים סימון קיים ומשייכים לו קטגוריית מושב במאפייני הסימון. הכרטיס אינו מפעיל כלי זיהוי או מדידה.',
      tool: null, category: 'seat', operationMode: 'label-only', operationLabel: 'תיוג בלבד · לא כלי זיהוי'
    }),
    Object.freeze({
      id: 'stems', name: 'ירכות ודפנות', group: 'reference', color: '#65a30d',
      description: 'סימון ירך או דופן לצורך בדיקת מבנה, נטייה ומקבילות.',
      measurementDescription: 'זהו תיוג ידני לסימון קיים. לזיהוי אוטומטי של ירך ימין וגבול הלובן הפנימי שלה משתמשים ב„זיהוי נטיית ירך ימין” או במדד „נטיות”. בדיקת „מקבילות” נשמרת כמדד נפרד.',
      tool: null, category: 'stem', operationMode: 'label-only', operationLabel: 'תיוג ידני · הזיהוי נמצא בנטיות'
    }),
    Object.freeze({
      id: 'reference-template', name: 'תבנית אות', group: 'reference', color: '#a16207',
      description: 'מסגרת או אות וקטורית המשמשת תבנית ייחוס ואינה משנה את צילום המקור.',
      measurementDescription: 'התבנית נשמרת כווקטור נפרד עם קישור יציב למסגרת המקור שלה.',
      tool: null, category: 'reference-template', operationMode: 'information', operationLabel: 'אובייקט ייחוס · לא מדידה'
    }),
    Object.freeze({
      id: 'other', name: 'אחר', group: 'reference', color: '#475569',
      description: 'סימון שטרם שויך להגדרה מקצועית מדויקת.',
      measurementDescription: 'הסימון נשמר בצבע ניטרלי קבוע עד שיוחלף בהגדרה מקצועית מפורשת.',
      tool: null, category: 'other', operationMode: 'label-only', operationLabel: 'תיוג ניטרלי בלבד'
    })
  ]);

  const LETTER_FAMILIES = Object.freeze([
    Object.freeze({
      id: 'narrow-letters',
      name: 'משפחת האותיות הצרות',
      letters: Object.freeze(['נ', 'י', 'ו', 'ז']),
      comparison: 'width',
      status: 'definition-pending'
    }),
    Object.freeze({
      id: 'internal-white',
      name: 'משפחת הלובן הפנימי',
      letters: Object.freeze(['ב', 'ד', 'ה', 'ת']),
      comparison: 'internal-white',
      status: 'definition-pending'
    })
  ]);

  const BY_ID = new Map(METRICS.map(metric => [metric.id, metric]));
  const METRIC_ALIASES = Object.freeze({ 'slants-parallels': 'slants' });
  const CATEGORY_TO_METRIC = Object.freeze({
    width: 'widths', height: 'heights', nib: 'nib', straightness: 'straightness',
    weight: 'weights', root: 'weights', 'white-space': 'white-balance',
    'optical-center': 'optical-center', balcony: 'balconies', slant: 'slants',
    parallel: 'parallels', thirds: 'thirds', geometry: 'circle-ellipse',
    roof: 'roofs', seat: 'seats', stem: 'stems',
    'reference-template': 'reference-template', other: 'other',
    'letter-gap': 'gaps', 'word-gap': 'gaps', 'line-gap': 'gaps'
  });
  const FORMULA_TO_METRIC = Object.freeze({
    'balcony-width': 'balconies', 'roof-seat': 'roof-seat', 'root-weight': 'weights',
    'max-weight': 'weights', 'roof-length': 'widths', 'common-gap': 'gaps',
    'between-letters': 'gaps', 'between-words': 'gaps', 'between-lines': 'gaps',
    'between-heads': 'gaps', 'shin-teeth': 'gaps', 'bet-seat-line': 'straightness'
  });

  function canonicalMetricId(id) { return METRIC_ALIASES[id] || id || null; }
  function metric(id) { return BY_ID.get(canonicalMetricId(id)) || null; }
  function fixedMetricIdFor({ type, measurementBasis, auto, sourceScanId, sourceScanUid } = {}) {
    if (type === 'weightSample') return 'weights';
    if (type === 'parallelCheck') return 'parallels';
    if (type === 'slantScan') return 'slants';
    if (type === 'angle' && (
      measurementBasis === 'inner-white-boundary' ||
      measurementBasis === 'legacy-center-axis' ||
      auto === true || sourceScanId != null || sourceScanUid
    )) return 'slants';
    return null;
  }
  function metricIdFor(input = {}) {
    const { semanticMetricId, formulaKey, category, type } = input;
    const fixedMetricId = fixedMetricIdFor(input);
    if (fixedMetricId) return fixedMetricId;
    const canonicalSemanticId = canonicalMetricId(semanticMetricId);
    if (BY_ID.has(canonicalSemanticId)) return canonicalSemanticId;
    if (FORMULA_TO_METRIC[formulaKey]) return FORMULA_TO_METRIC[formulaKey];
    if (CATEGORY_TO_METRIC[category]) return CATEGORY_TO_METRIC[category];
    if (type === 'rowAlign') return 'straightness';
    if (type === 'ellipse' || type === 'circle') return 'circle-ellipse';
    if (type === 'nib' || type === 'nibRegion') return 'nib';
    if (type === 'area') return 'white-balance';
    if (type === 'parallelCheck') return 'parallels';
    if (type === 'weightSample') return 'weights';
    if (type === 'thirds' || type === 'kastel') return 'thirds';
    if (type === 'gap') return 'gaps';
    if (type === 'length') return 'widths';
    return null;
  }
  function colorFor(input, fallback = '#64748b') {
    return metric(metricIdFor(input))?.color || fallback;
  }
  function defaultDescriptions() {
    return Object.fromEntries(METRICS.map(item => [item.id, item.description]));
  }
  function defaultMeasurementNotes() {
    return Object.fromEntries(METRICS.map(item => [item.id, item.measurementDescription || '']));
  }
  function mergeDescriptions(saved = {}) {
    const defaults = defaultDescriptions();
    for (const [id, value] of Object.entries(saved || {})) {
      // A description for the former combined slants/parallels metric cannot
      // safely describe either new measurement. Keep it under its inert legacy
      // key so re-saving does not destroy user copy, but never apply it to a
      // current card.
      if (BY_ID.has(id) && typeof value === 'string' && value.trim()) defaults[id] = value.trim();
      else if (METRIC_ALIASES[id] && typeof value === 'string' && value.trim()) defaults[id] = value.trim();
    }
    return defaults;
  }
  function mergeMeasurementNotes(saved = {}) {
    const defaults = defaultMeasurementNotes();
    for (const [id, value] of Object.entries(saved || {})) {
      if (BY_ID.has(id) && typeof value === 'string' && value.trim()) defaults[id] = value.trim();
      else if (METRIC_ALIASES[id] && typeof value === 'string' && value.trim()) defaults[id] = value.trim();
    }
    return defaults;
  }
  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  function rowAlignmentFromCandidates(candidates = [], nibPx = null) {
    const eligible = candidates
      .filter(candidate => candidate && candidate.eligible === true && ['ב', 'כ', 'נ'].includes(candidate.letter) && Number.isFinite(+candidate.y))
      .map(candidate => ({ ...candidate, y: +candidate.y }))
      .filter(candidate => !['י', 'ן'].includes(candidate.letter || ''));
    if (!eligible.length) return { baselineY: null, candidates: [] };
    const baselineY = Math.max(...eligible.map(candidate => candidate.y));
    return {
      baselineY,
      candidates: eligible.map(candidate => ({
        ...candidate,
        deviationPx: baselineY - candidate.y,
        deviationNib: Number.isFinite(+nibPx) && +nibPx > 0 ? (baselineY - candidate.y) / +nibPx : null
      }))
    };
  }
  function compareBalconies(samples = []) {
    const normalized = samples
      .filter(sample => ['ו', 'ת'].includes(sample?.letter) && sample?.value != null && Number.isFinite(+sample.value))
      .map(sample => ({ ...sample, value: +sample.value }));
    const vav = normalized.filter(sample => sample.letter === 'ו');
    const tav = normalized.filter(sample => sample.letter === 'ת');
    const vavMedian = median(vav.map(sample => sample.value));
    const tavMedian = median(tav.map(sample => sample.value));
    return {
      vav: { count: vav.length, median: vavMedian },
      tav: { count: tav.length, median: tavMedian },
      difference: vavMedian == null || tavMedian == null ? null : tavMedian - vavMedian,
      classification: null
    };
  }
  function signedVerticalAngle(a, b) {
    if (!a || !b) return 0;
    let value = Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI;
    while (value > 90) value -= 180;
    while (value < -90) value += 180;
    return value;
  }
  function parallelSignedDifferenceDeg(firstAngle, secondAngle) {
    if (firstAngle == null || secondAngle == null || firstAngle === '' || secondAngle === '' ||
        !Number.isFinite(+firstAngle) || !Number.isFinite(+secondAngle)) return null;
    let difference = (+firstAngle - +secondAngle) % 180;
    if (difference > 90) difference -= 180;
    if (difference < -90) difference += 180;
    return difference;
  }
  function parallelDeviationDeg(firstAngle, secondAngle) {
    const difference = parallelSignedDifferenceDeg(firstAngle, secondAngle);
    return difference == null ? null : Math.abs(difference);
  }
  function weightStep(points) {
    const normalized = Number(points);
    return WEIGHT_STEPS.find(step => step.points === normalized) || null;
  }
  function shearPointToAngle(point, pivotY, currentDeg, targetDeg) {
    const current = Math.tan((+currentDeg || 0) * Math.PI / 180);
    const target = Math.tan((+targetDeg || 0) * Math.PI / 180);
    return { x: point.x + (pivotY - point.y) * (target - current), y: point.y };
  }

  return Object.freeze({
    version: '1.2.0', GROUPS, METRICS, LETTER_FAMILIES, WEIGHT_STEPS,
    CATEGORY_TO_METRIC, FORMULA_TO_METRIC, METRIC_ALIASES,
    canonicalMetricId, metric, fixedMetricIdFor, metricIdFor, colorFor, defaultDescriptions, defaultMeasurementNotes,
    mergeDescriptions, mergeMeasurementNotes, median,
    rowAlignmentFromCandidates, compareBalconies, signedVerticalAngle,
    parallelSignedDifferenceDeg, parallelDeviationDeg, weightStep, shearPointToAngle
  });
})();
