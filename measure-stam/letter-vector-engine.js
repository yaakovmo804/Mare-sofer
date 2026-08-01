'use strict';

/**
 * Editable vector support for the Medidaot letter board.
 *
 * The existing MEDIDAOT_LETTERS assets remain the canonical, lazy fallback.
 * A saved object receives an enumerable `letterVector` payload only when an
 * editing operation calls `materializeObjectVector`, `setObjectWeight`, or
 * `moveObjectHandle`.
 */
globalThis.MEDIDAOT_VECTOR_ENGINE = (() => {
  const API_VERSION = 1;
  const VECTOR_SCHEMA_VERSION = 3;
  const VECTOR_PROPERTY = 'letterVector';
  const LAYOUT_TIGHT = 'tight-v1';
  const LAYOUT_SOURCE_CELL = 'source-cell-v2';
  const WEIGHT_MIN = 0.55;
  const WEIGHT_MAX = 1.45;
  const EPSILON = 1e-8;

  const SOURCE_BOARD = Object.freeze({
    schemaVersion: 1,
    sourcePage: 1,
    pageWidth: 841.89,
    pageHeight: 595.276,
    units: 'pdf-points',
    canonicalCellWidth: 61.91,
    canonicalCellHeight: 64.164,
    extractionPadding: 2
  });

  /*
   * [style, Hebrew letter, slug, file,
   *  cell left, top, right, bottom,
   *  outline left, top, right, bottom, drawing count]
   *
   * These are the values from
   * tmp/letters-analysis/extracted/manifest.json. They deliberately retain
   * the source-board positions: a lamed or final letter may extend beyond its
   * nominal cell.
   */
  const METRIC_ROWS = [
    ['beit-yosef', 'א', 'aleph', 'beit-yosef/aleph.svg', 646.695, 147.535, 708.605, 211.699, 656.473, 148.559, 696.914, 208.18, 1],
    ['beit-yosef', 'ב', 'bet', 'beit-yosef/bet.svg', 575.699, 147.535, 637.609, 211.699, 586.914, 146.469, 624.852, 200.418, 1],
    ['beit-yosef', 'ג', 'gimel', 'beit-yosef/gimel.svg', 504.707, 147.535, 566.617, 211.699, 524.336, 141.91, 549.461, 202.156, 2],
    ['beit-yosef', 'ד', 'dalet', 'beit-yosef/dalet.svg', 433.711, 147.535, 495.621, 211.699, 442.617, 147.035, 485.879, 199.852, 3],
    ['beit-yosef', 'ה', 'he', 'beit-yosef/he.svg', 362.715, 147.535, 424.625, 211.699, 373.754, 147.242, 415.094, 200.668, 1],
    ['beit-yosef', 'ו', 'vav', 'beit-yosef/vav.svg', 291.719, 147.535, 353.629, 211.699, 315.078, 158.469, 330.785, 200.695, 1],
    ['beit-yosef', 'ז', 'zayin', 'beit-yosef/zayin.svg', 220.727, 147.535, 282.637, 211.699, 244.422, 141.973, 260.418, 200.375, 2],
    ['beit-yosef', 'ח', 'het', 'beit-yosef/het.svg', 149.73, 147.535, 211.64, 211.699, 157.234, 145.707, 201.742, 201.246, 1],
    ['beit-yosef', 'ט', 'tet', 'beit-yosef/tet.svg', 78.734, 147.535, 140.644, 211.699, 87.898, 142, 134.926, 201.973, 2],
    ['beit-yosef', 'י', 'yod', 'beit-yosef/yod.svg', 646.695, 229.184, 708.605, 293.348, 668.516, 232.035, 687.406, 267.227, 1],
    ['beit-yosef', 'כ', 'kaf', 'beit-yosef/kaf.svg', 575.699, 229.184, 637.609, 293.348, 588.305, 240.973, 625.508, 281.641, 1],
    ['beit-yosef', 'ך', 'final-kaf', 'beit-yosef/final-kaf.svg', 504.707, 229.184, 566.617, 293.348, 516.188, 239.539, 550.574, 314.68, 1],
    ['beit-yosef', 'ל', 'lamed', 'beit-yosef/lamed.svg', 433.711, 229.184, 495.621, 293.348, 432.297, 201.063, 492.223, 281.961, 1],
    ['beit-yosef', 'מ', 'mem', 'beit-yosef/mem.svg', 362.715, 229.184, 424.625, 293.348, 371.086, 237.086, 415.926, 283.371, 1],
    ['beit-yosef', 'ם', 'final-mem', 'beit-yosef/final-mem.svg', 291.719, 229.184, 353.629, 293.348, 300.762, 240.563, 341.125, 285.59, 1],
    ['beit-yosef', 'נ', 'nun', 'beit-yosef/nun.svg', 220.727, 229.184, 282.637, 293.348, 240.879, 224.367, 264.051, 281.715, 3],
    ['beit-yosef', 'ן', 'final-nun', 'beit-yosef/final-nun.svg', 149.73, 229.184, 211.64, 293.348, 172.156, 224.961, 189.074, 308.484, 2],
    ['beit-yosef', 'ס', 'samekh', 'beit-yosef/samekh.svg', 78.734, 229.184, 140.644, 293.348, 90.902, 240.395, 132.023, 282.078, 1],
    ['beit-yosef', 'ע', 'ayin', 'beit-yosef/ayin.svg', 646.695, 310.832, 708.605, 374.996, 660.309, 304.906, 697.184, 377.938, 3],
    ['beit-yosef', 'פ', 'pe', 'beit-yosef/pe.svg', 575.699, 310.832, 637.609, 374.996, 590.91, 308.25, 625.16, 378.59, 1],
    ['beit-yosef', 'ף', 'final-pe', 'beit-yosef/final-pe.svg', 504.707, 310.832, 566.617, 374.996, 518.789, 309.273, 558.078, 395.762, 1],
    ['beit-yosef', 'צ', 'tsadi', 'beit-yosef/tsadi.svg', 433.711, 310.832, 495.621, 374.996, 449.359, 304.863, 486, 363.332, 2],
    ['beit-yosef', 'ץ', 'final-tsadi', 'beit-yosef/final-tsadi.svg', 362.715, 310.832, 424.625, 374.996, 376.844, 304.496, 415.629, 389.18, 2],
    ['beit-yosef', 'ק', 'qof', 'beit-yosef/qof.svg', 291.719, 310.832, 353.629, 374.996, 303.582, 312.145, 343.906, 391.121, 2],
    ['beit-yosef', 'ר', 'resh', 'beit-yosef/resh.svg', 220.727, 310.832, 282.637, 374.996, 233.621, 321.867, 276.746, 363.664, 1],
    ['beit-yosef', 'ש', 'shin', 'beit-yosef/shin.svg', 149.73, 310.832, 211.64, 374.996, 154.258, 305.832, 205.418, 363.617, 2],
    ['beit-yosef', 'ת', 'tav', 'beit-yosef/tav.svg', 78.734, 310.832, 140.644, 374.996, 84.926, 322.035, 131.109, 363.496, 1],
    ['ari', 'א', 'aleph', 'ari/aleph.svg', 646.695, 404.121, 708.605, 468.285, 657.75, 400.801, 697.508, 464.402, 1],
    ['ari', 'ו', 'vav', 'ari/vav.svg', 575.699, 404.121, 637.609, 468.285, 598.563, 406.977, 614.426, 458.043, 1],
    ['ari', 'ח', 'het', 'ari/het.svg', 504.707, 404.121, 566.617, 468.285, 513.559, 402.547, 556.004, 456.93, 1],
    ['ari', 'ט', 'tet', 'ari/tet.svg', 433.711, 404.121, 495.621, 468.285, 448.16, 398.063, 483.262, 471.809, 2],
    ['ari', 'צ', 'tsadi', 'ari/tsadi.svg', 362.715, 404.121, 424.625, 468.285, 374.781, 397.391, 412.457, 456.547, 2],
    ['ari', 'ק', 'qof', 'ari/qof.svg', 291.719, 404.121, 353.629, 468.285, 304.832, 398.246, 342.121, 482.156, 2],
    ['ari', 'ש', 'shin', 'ari/shin.svg', 220.727, 404.121, 282.637, 468.285, 223.707, 398.492, 275.887, 457.469, 2]
  ];

  const parsedAssetCache = new Map();
  let effectivePathCache = new WeakMap();
  let path2DCache = new WeakMap();
  const legacyPath2DCache = new Map();
  const path2DConstructorIds = new WeakMap();
  let nextPath2DConstructorId = 1;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function round(value, digits = 6) {
    const multiplier = 10 ** digits;
    const result = Math.round(finiteNumber(value) * multiplier) / multiplier;
    return Object.is(result, -0) ? 0 : result;
  }

  function rectFromLTRB(left, top, right, bottom) {
    return Object.freeze({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      left,
      top,
      right,
      bottom
    });
  }

  function freezeMetric(row) {
    const [style, letter, slug, file, cl, ct, cr, cb, ol, ot, or, ob, drawingCount] = row;
    const sourceCell = rectFromLTRB(cl, ct, cr, cb);
    const outlineBounds = rectFromLTRB(ol, ot, or, ob);
    const padding = SOURCE_BOARD.extractionPadding;
    const outlineOffsetInCell = Object.freeze({ x: ol - cl, y: ot - ct });
    const assetOriginInCell = Object.freeze({
      x: ol - cl - padding,
      y: ot - ct - padding
    });
    return Object.freeze({
      key: `${style}:${letter}`,
      style,
      tradition: style === 'ari' ? 'ari' : 'beitYosef',
      letter,
      slug,
      file,
      sourceCell,
      outlineBounds,
      outlineOffsetInCell,
      assetOriginInCell,
      assetViewBox: Object.freeze([
        0,
        0,
        outlineBounds.width + padding * 2,
        outlineBounds.height + padding * 2
      ]),
      sourceDrawingCount: drawingCount,
      sourcePage: SOURCE_BOARD.sourcePage,
      sourcePageSize: Object.freeze([SOURCE_BOARD.pageWidth, SOURCE_BOARD.pageHeight])
    });
  }

  const METRICS = new Map(METRIC_ROWS.map(row => {
    const metric = freezeMetric(row);
    return [metric.key, metric];
  }));
  const ARI_OVERRIDE_LETTERS = Object.freeze(
    METRIC_ROWS.filter(row => row[0] === 'ari').map(row => row[1])
  );

  function clonePoint(point) {
    return { x: finiteNumber(point?.x), y: finiteNumber(point?.y) };
  }

  function clonePlainMetadata(value) {
    if (Array.isArray(value)) return value.map(clonePlainMetadata);
    if (!value || typeof value !== 'object') return value;
    const copy = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = clonePlainMetadata(entry);
    return copy;
  }

  function cloneCommand(command) {
    if (!command || typeof command !== 'object') {
      throw new TypeError('A vector command must be an object.');
    }
    if (command.type === 'M' || command.type === 'L') {
      return { type: command.type, x: finiteNumber(command.x), y: finiteNumber(command.y) };
    }
    if (command.type === 'C') {
      return {
        type: 'C',
        x1: finiteNumber(command.x1),
        y1: finiteNumber(command.y1),
        x2: finiteNumber(command.x2),
        y2: finiteNumber(command.y2),
        x: finiteNumber(command.x),
        y: finiteNumber(command.y)
      };
    }
    if (command.type === 'Z') return { type: 'Z' };
    throw new TypeError(`Unsupported vector command: ${String(command.type)}`);
  }

  function clonePaths(paths) {
    return (paths || []).map(entry => ({
      rule: entry?.rule === 'evenodd' ? 'evenodd' : 'nonzero',
      commands: (entry?.commands || []).map(cloneCommand)
    }));
  }

  function topologyBasePaths(vector) {
    return vector?.composition?.mode === 'organ-subpaths-v1'
      && Array.isArray(vector.composition.basePaths)
      ? vector.composition.basePaths
      : vector?.paths || [];
  }

  function topologyOrgans(vector) {
    return Array.isArray(vector?.organs)
      ? vector.organs.filter(organ => Array.isArray(organ?.paths) && organ.paths.length)
      : [];
  }

  function formatHandleId(pathIndex, commandIndex, role, organId = null) {
    const base = `p${pathIndex}:c${commandIndex}:${role}`;
    return organId ? `o:${organId}:${base}` : base;
  }

  function parseHandleId(handleId) {
    const value = String(handleId);
    const organMatch = /^o:([^:]+):p(\d+):c(\d+):(anchor|control-in|control-out)$/.exec(value);
    const flatMatch = /^p(\d+):c(\d+):(anchor|control-in|control-out)$/.exec(value);
    const match = organMatch || flatMatch;
    if (!match) throw new TypeError(`Invalid vector handle id: ${value}`);
    return organMatch ? {
      organId: organMatch[1],
      pathIndex: Number(organMatch[2]),
      commandIndex: Number(organMatch[3]),
      role: organMatch[4]
    } : {
      organId: null,
      pathIndex: Number(flatMatch[1]),
      commandIndex: Number(flatMatch[2]),
      role: flatMatch[3]
    };
  }

  function handlePathContext(vector, handle) {
    if (handle.organId) {
      const organ = topologyOrgans(vector).find(item => item.id === handle.organId);
      return organ ? { organ, paths: organ.paths, namespace: organ.id } : null;
    }
    return { organ: null, paths: topologyBasePaths(vector), namespace: null };
  }

  function commandForHandle(vector, handleId) {
    const parsed = typeof handleId === 'string' ? parseHandleId(handleId) : handleId;
    const context = handlePathContext(vector, parsed);
    const command = context?.paths?.[parsed.pathIndex]?.commands?.[parsed.commandIndex];
    return command ? { parsed, context, command } : null;
  }

  function anchorPointForId(vector, handleId) {
    const resolved = commandForHandle(vector, handleId);
    if (!resolved || resolved.parsed.role !== 'anchor' || !['M', 'L', 'C'].includes(resolved.command.type)) return null;
    return { x: resolved.command.x, y: resolved.command.y };
  }

  function topologyConnectorPaths(vector) {
    const connectors = [];
    for (const organ of topologyOrgans(vector)) {
      const ports = (organ.boundaryPorts || []).filter(port => port?.sourceAnchorId && port?.organAnchorId);
      if (ports.length !== 2) continue;
      const source = ports.map(port => anchorPointForId(vector, port.sourceAnchorId) || port.sourcePoint).filter(Boolean);
      const target = ports.map(port => anchorPointForId(vector, port.organAnchorId)).filter(Boolean);
      if (source.length !== 2 || target.length !== 2) continue;
      connectors.push({
        rule: 'nonzero',
        commands: [
          { type: 'M', x: source[0].x, y: source[0].y },
          { type: 'L', x: source[1].x, y: source[1].y },
          { type: 'L', x: target[1].x, y: target[1].y },
          { type: 'L', x: target[0].x, y: target[0].y },
          { type: 'Z' }
        ]
      });
    }
    return connectors;
  }

  function topologyRenderPaths(vector) {
    if (vector?.composition?.mode !== 'organ-subpaths-v1') return vector?.paths || [];
    return [
      ...topologyBasePaths(vector),
      ...topologyOrgans(vector).flatMap(organ => organ.paths),
      ...topologyConnectorPaths(vector)
    ];
  }

  function topologyEditablePaths(vector) {
    return [
      ...topologyBasePaths(vector),
      ...topologyOrgans(vector).flatMap(organ => organ.paths)
    ];
  }

  function deepFreezePaths(paths) {
    for (const entry of paths) {
      for (const command of entry.commands) Object.freeze(command);
      Object.freeze(entry.commands);
      Object.freeze(entry);
    }
    return Object.freeze(paths);
  }

  function normalizeTradition(value) {
    if (value === 'custom') return 'custom';
    return value === 'ari' || value === 'ארי' || value === 'כתב האר״י'
      ? 'ari'
      : 'beitYosef';
  }

  function traditionToStyle(value) {
    const tradition = normalizeTradition(value);
    if (tradition === 'custom') return 'custom';
    return tradition === 'ari' ? 'ari' : 'beit-yosef';
  }

  function identityFrom(input, tradition) {
    if (typeof input === 'string') {
      return { letter: input, tradition: normalizeTradition(tradition) };
    }
    const template = input?.template || input || {};
    const inferredTradition = template.style === 'ari' || input?.style === 'ari'
      ? 'ari'
      : tradition;
    return {
      letter: template.letter || input?.letter || 'א',
      tradition: normalizeTradition(template.tradition || input?.tradition || inferredTradition)
    };
  }

  function resolveLegacyAsset(input, tradition) {
    if (input?.viewBox && Array.isArray(input?.paths) && input.paths.some(path => typeof path?.d === 'string')) {
      return input;
    }
    const identity = identityFrom(input, tradition);
    return globalThis.MEDIDAOT_LETTERS?.traditions?.[identity.tradition]?.[identity.letter] || null;
  }

  function metricForIdentity(identity) {
    const requestedStyle = traditionToStyle(identity.tradition);
    return METRICS.get(`${requestedStyle}:${identity.letter}`)
      || METRICS.get(`beit-yosef:${identity.letter}`)
      || null;
  }

  /**
   * Returns source-board measurements. Ari letters without a dedicated source
   * form resolve to their Beit Yosef metric and carry `isAriOverride: false`.
   */
  function getSourceMetrics(input, tradition) {
    const identity = identityFrom(input, tradition);
    const metric = metricForIdentity(identity);
    if (!metric) return null;
    return {
      ...metric,
      requestedTradition: identity.tradition,
      resolvedTradition: metric.tradition,
      isAriOverride: identity.tradition === 'ari' && metric.style === 'ari',
      sourceCell: { ...metric.sourceCell },
      outlineBounds: { ...metric.outlineBounds },
      outlineOffsetInCell: { ...metric.outlineOffsetInCell },
      assetOriginInCell: { ...metric.assetOriginInCell },
      assetViewBox: [...metric.assetViewBox],
      sourcePageSize: [...metric.sourcePageSize]
    };
  }

  function listSourceMetrics(options = {}) {
    const includeAriOverrides = options.includeAriOverrides !== false;
    return METRIC_ROWS
      .filter(row => includeAriOverrides || row[0] === 'beit-yosef')
      .map(row => getSourceMetrics(row[1], row[0] === 'ari' ? 'ari' : 'beitYosef'))
      .filter(Boolean);
  }

  function tokenisePathData(pathData) {
    if (typeof pathData !== 'string') throw new TypeError('SVG path data must be a string.');
    const tokens = [];
    const tokenPattern = /[MLCZ]|[-+]?(?:(?:\d+\.\d*)|(?:\.\d+)|(?:\d+))(?:[eE][-+]?\d+)?/g;
    let previousEnd = 0;
    let match;
    while ((match = tokenPattern.exec(pathData))) {
      const gap = pathData.slice(previousEnd, match.index);
      if (gap && !/^[\s,]*$/.test(gap)) {
        throw new SyntaxError(`Unsupported or malformed SVG path segment near "${gap.trim()}".`);
      }
      tokens.push(match[0]);
      previousEnd = tokenPattern.lastIndex;
    }
    const tail = pathData.slice(previousEnd);
    if (tail && !/^[\s,]*$/.test(tail)) {
      throw new SyntaxError(`Unsupported or malformed SVG path tail "${tail.trim()}".`);
    }
    return tokens;
  }

  /**
   * Parses the extraction format (absolute M/L/C/Z only) into editable,
   * persistence-safe command objects.
   */
  function parsePathData(pathData) {
    const tokens = tokenisePathData(pathData);
    const commands = [];
    let index = 0;
    let active = null;
    let firstMovePair = false;

    const requireNumbers = count => {
      if (index + count > tokens.length || tokens.slice(index, index + count).some(token => /^[MLCZ]$/.test(token))) {
        throw new SyntaxError(`Command ${active || '?'} is missing numeric parameters.`);
      }
      const result = tokens.slice(index, index + count).map(Number);
      if (result.some(value => !Number.isFinite(value))) {
        throw new SyntaxError(`Command ${active || '?'} contains an invalid number.`);
      }
      index += count;
      return result;
    };

    while (index < tokens.length) {
      const token = tokens[index];
      if (/^[MLCZ]$/.test(token)) {
        active = token;
        index += 1;
        firstMovePair = active === 'M';
        if (active === 'Z') {
          commands.push({ type: 'Z' });
          active = null;
          continue;
        }
      } else if (!active) {
        throw new SyntaxError('SVG path data begins with numbers or follows Z without a command.');
      }

      if (active === 'M') {
        const [x, y] = requireNumbers(2);
        commands.push({ type: firstMovePair ? 'M' : 'L', x, y });
        firstMovePair = false;
      } else if (active === 'L') {
        const [x, y] = requireNumbers(2);
        commands.push({ type: 'L', x, y });
      } else if (active === 'C') {
        const [x1, y1, x2, y2, x, y] = requireNumbers(6);
        commands.push({ type: 'C', x1, y1, x2, y2, x, y });
      }
    }
    if (!commands.length || commands[0].type !== 'M') {
      throw new SyntaxError('SVG path data must begin with an absolute M command.');
    }
    return commands;
  }

  function formatNumber(value, precision) {
    const number = round(value, precision);
    return String(number);
  }

  function serializePathData(commands, options = {}) {
    const precision = clamp(Math.trunc(finiteNumber(options.precision, 6)), 0, 12);
    return (commands || []).map(command => {
      if (command.type === 'M' || command.type === 'L') {
        return `${command.type}${formatNumber(command.x, precision)} ${formatNumber(command.y, precision)}`;
      }
      if (command.type === 'C') {
        return `C${formatNumber(command.x1, precision)} ${formatNumber(command.y1, precision)} `
          + `${formatNumber(command.x2, precision)} ${formatNumber(command.y2, precision)} `
          + `${formatNumber(command.x, precision)} ${formatNumber(command.y, precision)}`;
      }
      if (command.type === 'Z') return 'Z';
      throw new TypeError(`Unsupported vector command: ${String(command.type)}`);
    }).join(' ');
  }

  function legacyAssetSignature(asset) {
    return JSON.stringify([
      asset?.style || '',
      asset?.slug || '',
      asset?.viewBox || [],
      (asset?.paths || []).map(path => [path?.rule || 'nonzero', path?.d || ''])
    ]);
  }

  function legacyAssetKey(asset) {
    const style = asset?.style || 'unknown';
    const slug = asset?.slug || 'glyph';
    return `${style}:${slug}`;
  }

  function trimMap(map, maximumSize) {
    while (map.size > maximumSize) {
      const first = map.keys().next().value;
      map.delete(first);
    }
  }

  function parseLegacyAssetInternal(asset) {
    if (!asset || !Array.isArray(asset.viewBox) || !Array.isArray(asset.paths)) {
      throw new TypeError('A legacy letter asset with viewBox and paths is required.');
    }
    const key = legacyAssetKey(asset);
    const signature = legacyAssetSignature(asset);
    const cached = parsedAssetCache.get(key);
    if (cached?.signature === signature) return cached.data;

    const parsed = {
      schemaVersion: VECTOR_SCHEMA_VERSION,
      sourceKey: key,
      letter: asset.letter || '',
      tradition: asset.style === 'ari' ? 'ari' : 'beitYosef',
      style: asset.style || 'beit-yosef',
      slug: asset.slug || '',
      viewBox: Object.freeze(asset.viewBox.slice(0, 4).map(value => finiteNumber(value))),
      weight: 1,
      revision: 0,
      paths: deepFreezePaths(asset.paths.map(path => ({
        rule: path?.rule === 'evenodd' ? 'evenodd' : 'nonzero',
        commands: parsePathData(path?.d || '')
      })))
    };
    Object.freeze(parsed);
    parsedAssetCache.set(key, { signature, data: parsed });
    trimMap(parsedAssetCache, 64);
    return parsed;
  }

  function parseLegacyAsset(asset, options = {}) {
    const parsed = parseLegacyAssetInternal(asset);
    if (options.clone === false) return parsed;
    return {
      ...parsed,
      viewBox: [...parsed.viewBox],
      paths: clonePaths(parsed.paths)
    };
  }

  function isVectorData(value) {
    return Boolean(
      value
      && typeof value === 'object'
      && Array.isArray(value.viewBox)
      && Array.isArray(value.paths)
      && value.paths.every(entry => Array.isArray(entry?.commands))
    );
  }

  function getObjectVector(object) {
    const candidate = object?.[VECTOR_PROPERTY];
    return isVectorData(candidate) ? candidate : null;
  }

  function hasMaterializedVector(object) {
    return Boolean(getObjectVector(object));
  }

  function getVectorSource(input, options = {}) {
    if (isVectorData(input)) return input;
    const existing = getObjectVector(input);
    if (existing) return existing;
    if (options.materialize && input && typeof input === 'object') {
      return materializeObjectVector(input, options);
    }
    const asset = options.asset || resolveLegacyAsset(input, options.tradition);
    return asset ? parseLegacyAssetInternal(asset) : null;
  }

  function calculateHandleCountsFromPaths(paths) {
    let anchors = 0;
    let controls = 0;
    for (const entry of paths || []) {
      for (const command of entry.commands || []) {
        if (command.type === 'M' || command.type === 'L') anchors += 1;
        else if (command.type === 'C') {
          anchors += 1;
          controls += 2;
        }
      }
    }
    return { anchors, controls, total: anchors + controls };
  }

  function normalizedWeight(value) {
    return clamp(finiteNumber(value, 1), WEIGHT_MIN, WEIGHT_MAX);
  }

  /**
   * Creates the persisted editable payload. Calling read/render APIs alone
   * never invokes this function and therefore never enlarges old projects.
   */
  function materializeObjectVector(object, options = {}) {
    if (!object || typeof object !== 'object') {
      throw new TypeError('A letter template object is required.');
    }
    const existing = getObjectVector(object);
    if (existing) {
      if (Math.trunc(finiteNumber(existing.schemaVersion, 1)) >= VECTOR_SCHEMA_VERSION) return existing;
      const migrated = cloneVectorData(existing, { ...options, migrationSource: existing.schemaVersion || 1 });
      object[VECTOR_PROPERTY] = migrated;
      object.letterWeight = migrated.weight;
      return migrated;
    }

    const asset = options.asset || resolveLegacyAsset(object, options.tradition);
    if (!asset) throw new Error('The legacy vector asset for this letter is unavailable.');
    const parsed = parseLegacyAssetInternal(asset);
    const identity = identityFrom(object, options.tradition);
    const weight = normalizedWeight(options.weight ?? object.letterWeight ?? 1);
    const paths = clonePaths(parsed.paths);
    const counts = calculateHandleCountsFromPaths(paths);
    const vector = {
      schemaVersion: VECTOR_SCHEMA_VERSION,
      sourceKey: parsed.sourceKey,
      letter: identity.letter || parsed.letter,
      tradition: identity.tradition,
      style: parsed.style,
      slug: parsed.slug,
      viewBox: [...parsed.viewBox],
      weight,
      revision: 1,
      paths,
      composition: {
        schemaVersion: VECTOR_SCHEMA_VERSION,
        mode: 'flat-source-v3',
        basePaths: clonePaths(paths),
        connectorMode: 'none'
      },
      features: [],
      organs: [],
      handleCounts: counts
    };
    object[VECTOR_PROPERTY] = vector;
    object.letterWeight = weight;
    return vector;
  }

  function cloneVectorData(source, options = {}) {
    const vector = getVectorSource(source, options);
    if (!vector) return null;
    const cloned = {
      schemaVersion: VECTOR_SCHEMA_VERSION,
      sourceKey: vector.sourceKey || '',
      letter: vector.letter || '',
      tradition: normalizeTradition(vector.tradition),
      style: vector.style || traditionToStyle(vector.tradition),
      slug: vector.slug || '',
      viewBox: vector.viewBox.slice(0, 4).map(value => finiteNumber(value)),
      weight: normalizedWeight(vector.weight),
      revision: Math.max(0, Math.trunc(finiteNumber(vector.revision))),
      paths: clonePaths(vector.paths)
    };
    if (vector.composition?.mode === 'organ-subpaths-v1' && Array.isArray(vector.composition.basePaths)) {
      cloned.composition = {
        ...clonePlainMetadata(vector.composition),
        schemaVersion: VECTOR_SCHEMA_VERSION,
        basePaths: clonePaths(vector.composition.basePaths)
      };
    } else {
      cloned.composition = {
        schemaVersion: VECTOR_SCHEMA_VERSION,
        mode: 'flat-source-v3',
        basePaths: clonePaths(vector.paths),
        connectorMode: 'none'
      };
    }
    if (Array.isArray(vector.features)) {
      cloned.features = clonePlainMetadata(vector.features).map(feature => {
        if (Array.isArray(feature.anchorIds) && !feature.anchorIds.length) {
          delete feature.anchorIds;
          feature.topologyStatus = 'unbound-reference';
        }
        return feature;
      });
    } else cloned.features = [];
    if (Array.isArray(vector.organs)) {
      cloned.organs = vector.organs.map(organ => ({
        ...clonePlainMetadata(organ),
        paths: Array.isArray(organ.paths) ? clonePaths(organ.paths) : undefined
      }));
    } else cloned.organs = [];
    if (vector.trace && typeof vector.trace === 'object') cloned.trace = clonePlainMetadata(vector.trace);
    for (const key of ['featureCoordinateSpace', 'featureAngleConvention']) {
      if (typeof vector[key] === 'string' && vector[key]) cloned[key] = vector[key];
    }
    const sourceSchema = Math.max(1, Math.trunc(finiteNumber(options.migrationSource ?? vector.schemaVersion, 1)));
    if (sourceSchema < VECTOR_SCHEMA_VERSION) {
      cloned.migration = {
        fromSchemaVersion: sourceSchema,
        toSchemaVersion: VECTOR_SCHEMA_VERSION,
        mode: 'legacy-flat-vectors'
      };
    }
    cloned.handleCounts = calculateHandleCountsFromPaths(topologyEditablePaths(cloned));
    return cloned;
  }

  function migrateVectorData(source) {
    if (!isVectorData(source)) throw new TypeError('Editable vector data is required.');
    return cloneVectorData(source, { migrationSource: source.schemaVersion || 1 });
  }

  function commandSignature(paths) {
    let signature = '';
    for (const entry of paths || []) {
      signature += entry.rule === 'evenodd' ? 'e|' : 'n|';
      for (const command of entry.commands || []) {
        signature += command.type;
        if (command.type === 'M' || command.type === 'L') {
          signature += `${command.x},${command.y};`;
        } else if (command.type === 'C') {
          signature += `${command.x1},${command.y1},${command.x2},${command.y2},${command.x},${command.y};`;
        } else {
          signature += ';';
        }
      }
    }
    return signature;
  }

  function vectorSignature(vector) {
    return `${normalizedWeight(vector?.weight)}#${Math.trunc(finiteNumber(vector?.revision))}#${commandSignature(topologyRenderPaths(vector))}`;
  }

  function touchVector(vector) {
    if (!isVectorData(vector)) throw new TypeError('Editable vector data is required.');
    vector.revision = Math.max(0, Math.trunc(finiteNumber(vector.revision))) + 1;
    vector.handleCounts = calculateHandleCountsFromPaths(topologyEditablePaths(vector));
    effectivePathCache.delete(vector);
    path2DCache.delete(vector);
    return vector.revision;
  }

  function invalidate(source) {
    const vector = isVectorData(source) ? source : getObjectVector(source);
    if (!vector) return false;
    touchVector(vector);
    return true;
  }

  function emptyBounds() {
    return { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  }

  function includePoint(bounds, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    bounds.left = Math.min(bounds.left, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.right = Math.max(bounds.right, x);
    bounds.bottom = Math.max(bounds.bottom, y);
  }

  function finishBounds(bounds) {
    if (!Number.isFinite(bounds.left)) {
      return { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
    }
    return {
      x: bounds.left,
      y: bounds.top,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom
    };
  }

  function cubicAt(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    return mt ** 3 * p0
      + 3 * mt ** 2 * t * p1
      + 3 * mt * t ** 2 * p2
      + t ** 3 * p3;
  }

  function cubicExtrema(p0, p1, p2, p3) {
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const c = p1 - p0;
    const roots = [];
    if (Math.abs(a) < EPSILON) {
      if (Math.abs(b) >= EPSILON) {
        const t = -c / b;
        if (t > 0 && t < 1) roots.push(t);
      }
      return roots;
    }
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return roots;
    const squareRoot = Math.sqrt(discriminant);
    const t1 = (-b + squareRoot) / (2 * a);
    const t2 = (-b - squareRoot) / (2 * a);
    if (t1 > 0 && t1 < 1) roots.push(t1);
    if (t2 > 0 && t2 < 1 && Math.abs(t2 - t1) > EPSILON) roots.push(t2);
    return roots;
  }

  /**
   * Exact axis-aligned bounds for M/L/C/Z commands, including cubic extrema.
   */
  function computePathBounds(paths) {
    const bounds = emptyBounds();
    for (const entry of paths || []) {
      let current = null;
      let start = null;
      for (const command of entry.commands || []) {
        if (command.type === 'M') {
          current = { x: command.x, y: command.y };
          start = { ...current };
          includePoint(bounds, current.x, current.y);
        } else if (command.type === 'L' && current) {
          includePoint(bounds, command.x, command.y);
          current = { x: command.x, y: command.y };
        } else if (command.type === 'C' && current) {
          includePoint(bounds, current.x, current.y);
          includePoint(bounds, command.x, command.y);
          const xRoots = cubicExtrema(current.x, command.x1, command.x2, command.x);
          const yRoots = cubicExtrema(current.y, command.y1, command.y2, command.y);
          for (const t of xRoots) {
            includePoint(
              bounds,
              cubicAt(current.x, command.x1, command.x2, command.x, t),
              cubicAt(current.y, command.y1, command.y2, command.y, t)
            );
          }
          for (const t of yRoots) {
            includePoint(
              bounds,
              cubicAt(current.x, command.x1, command.x2, command.x, t),
              cubicAt(current.y, command.y1, command.y2, command.y, t)
            );
          }
          current = { x: command.x, y: command.y };
        } else if (command.type === 'Z' && current && start) {
          includePoint(bounds, start.x, start.y);
          current = { ...start };
        }
      }
    }
    return finishBounds(bounds);
  }

  function squaredDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function pointLineDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const denominator = Math.hypot(dx, dy);
    if (denominator < EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
    return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / denominator;
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function flattenCubic(start, command, tolerance, output, depth = 0) {
    const control1 = { x: command.x1, y: command.y1 };
    const control2 = { x: command.x2, y: command.y2 };
    const end = { x: command.x, y: command.y };
    const flatness = Math.max(
      pointLineDistance(control1, start, end),
      pointLineDistance(control2, start, end)
    );
    if (flatness <= tolerance || depth >= 12) {
      output.push(end);
      return;
    }

    const p01 = midpoint(start, control1);
    const p12 = midpoint(control1, control2);
    const p23 = midpoint(control2, end);
    const p012 = midpoint(p01, p12);
    const p123 = midpoint(p12, p23);
    const split = midpoint(p012, p123);
    flattenCubic(start, {
      type: 'C',
      x1: p01.x,
      y1: p01.y,
      x2: p012.x,
      y2: p012.y,
      x: split.x,
      y: split.y
    }, tolerance, output, depth + 1);
    flattenCubic(split, {
      type: 'C',
      x1: p123.x,
      y1: p123.y,
      x2: p23.x,
      y2: p23.y,
      x: end.x,
      y: end.y
    }, tolerance, output, depth + 1);
  }

  function cleanPolygon(points, tolerance = 1e-6) {
    const result = [];
    const minimumSquared = tolerance * tolerance;
    for (const point of points || []) {
      const candidate = clonePoint(point);
      if (!result.length || squaredDistance(result[result.length - 1], candidate) > minimumSquared) {
        result.push(candidate);
      }
    }
    if (result.length > 1 && squaredDistance(result[0], result[result.length - 1]) <= minimumSquared) {
      result.pop();
    }
    if (result.length < 3) return result;

    const simplified = [];
    for (let index = 0; index < result.length; index += 1) {
      const previous = result[(index - 1 + result.length) % result.length];
      const current = result[index];
      const next = result[(index + 1) % result.length];
      const cross = (current.x - previous.x) * (next.y - current.y)
        - (current.y - previous.y) * (next.x - current.x);
      const lengthScale = Math.max(
        1,
        Math.hypot(current.x - previous.x, current.y - previous.y),
        Math.hypot(next.x - current.x, next.y - current.y)
      );
      if (Math.abs(cross) > tolerance * lengthScale) simplified.push(current);
    }
    return simplified.length >= 3 ? simplified : result;
  }

  function flattenPathEntry(entry, tolerance) {
    const contours = [];
    let points = null;
    let current = null;
    let start = null;

    const finish = () => {
      if (!points) return;
      const cleaned = cleanPolygon(points, tolerance * 0.02);
      if (cleaned.length >= 3) contours.push(cleaned);
      points = null;
      current = null;
      start = null;
    };

    for (const command of entry.commands || []) {
      if (command.type === 'M') {
        finish();
        current = { x: command.x, y: command.y };
        start = { ...current };
        points = [{ ...current }];
      } else if (command.type === 'L' && current && points) {
        current = { x: command.x, y: command.y };
        points.push({ ...current });
      } else if (command.type === 'C' && current && points) {
        flattenCubic(current, command, tolerance, points);
        current = { x: command.x, y: command.y };
      } else if (command.type === 'Z' && current && start) {
        finish();
      }
    }
    finish();
    return contours;
  }

  function polygonArea(points) {
    let sum = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      sum += current.x * next.y - next.x * current.y;
    }
    return sum / 2;
  }

  function polygonBounds(points) {
    const bounds = emptyBounds();
    for (const point of points || []) includePoint(bounds, point.x, point.y);
    return finishBounds(bounds);
  }

  function pointOnSegment(point, a, b, tolerance = 1e-7) {
    const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
    if (Math.abs(cross) > tolerance) return false;
    const dot = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
    if (dot < -tolerance) return false;
    const squaredLength = squaredDistance(a, b);
    return dot <= squaredLength + tolerance;
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
      const current = polygon[index];
      const previous = polygon[previousIndex];
      if (pointOnSegment(point, previous, current)) return true;
      const intersects = ((current.y > point.y) !== (previous.y > point.y))
        && point.x < ((previous.x - current.x) * (point.y - current.y))
          / ((previous.y - current.y) || EPSILON) + current.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function polygonInteriorPoint(points, area) {
    const bounds = polygonBounds(points);
    const span = Math.max(bounds.width, bounds.height, 1);
    const orientation = area >= 0 ? 1 : -1;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < EPSILON) continue;
      const middle = midpoint(a, b);
      /* For positive shoelace area, the algebraic interior is left. */
      const nx = orientation * -dy / length;
      const ny = orientation * dx / length;
      for (const multiplier of [1e-5, 1e-4, 1e-3, 1e-2]) {
        const candidate = {
          x: middle.x + nx * span * multiplier,
          y: middle.y + ny * span * multiplier
        };
        if (pointInPolygon(candidate, points)) return candidate;
      }
    }

    const average = points.reduce((result, point) => ({
      x: result.x + point.x / points.length,
      y: result.y + point.y / points.length
    }), { x: 0, y: 0 });
    if (pointInPolygon(average, points)) return average;
    return { ...points[0] };
  }

  function classifyContours(polygons, rule) {
    const contours = polygons.map((points, index) => {
      const area = polygonArea(points);
      return {
        index,
        points,
        area,
        areaMagnitude: Math.abs(area),
        sign: area >= 0 ? 1 : -1,
        bounds: polygonBounds(points),
        sample: polygonInteriorPoint(points, area),
        parent: -1,
        depth: 0,
        role: 'outer'
      };
    });

    for (const contour of contours) {
      let parent = -1;
      let parentArea = Infinity;
      for (const candidate of contours) {
        if (candidate.index === contour.index || candidate.areaMagnitude <= contour.areaMagnitude + EPSILON) continue;
        if (candidate.areaMagnitude >= parentArea) continue;
        if (pointInPolygon(contour.sample, candidate.points)) {
          parent = candidate.index;
          parentArea = candidate.areaMagnitude;
        }
      }
      contour.parent = parent;
    }

    const depthFor = contour => {
      let depth = 0;
      let parent = contour.parent;
      const visited = new Set([contour.index]);
      while (parent >= 0 && !visited.has(parent)) {
        visited.add(parent);
        depth += 1;
        parent = contours[parent]?.parent ?? -1;
      }
      return depth;
    };

    for (const contour of contours) {
      contour.depth = depthFor(contour);
      if (rule === 'evenodd') {
        contour.role = contour.depth % 2 === 1 ? 'hole' : 'outer';
        continue;
      }
      let outsideWinding = 0;
      let parent = contour.parent;
      const visited = new Set();
      while (parent >= 0 && !visited.has(parent)) {
        visited.add(parent);
        outsideWinding += contours[parent].sign;
        parent = contours[parent].parent;
      }
      const insideWinding = outsideWinding + contour.sign;
      if (outsideWinding !== 0 && insideWinding === 0) contour.role = 'hole';
      else if (outsideWinding === 0 && insideWinding !== 0) contour.role = 'outer';
      else contour.role = contour.depth % 2 === 1 ? 'hole' : 'outer';
    }
    return contours;
  }

  function unitVector(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < EPSILON) return null;
    return { x: dx / length, y: dy / length };
  }

  function outwardNormal(direction, orientation) {
    return orientation > 0
      ? { x: direction.y, y: -direction.x }
      : { x: -direction.y, y: direction.x };
  }

  function lineIntersection(pointA, directionA, pointB, directionB) {
    const denominator = directionA.x * directionB.y - directionA.y * directionB.x;
    if (Math.abs(denominator) < EPSILON) return null;
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const t = (dx * directionB.y - dy * directionB.x) / denominator;
    return {
      x: pointA.x + directionA.x * t,
      y: pointA.y + directionA.y * t
    };
  }

  function radialOffsetFallback(points, distance) {
    const bounds = polygonBounds(points);
    const center = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    };
    const minimumDimension = Math.max(EPSILON, Math.min(bounds.width, bounds.height));
    const factor = Math.max(0.12, 1 + 2 * distance / minimumDimension);
    return points.map(point => ({
      x: center.x + (point.x - center.x) * factor,
      y: center.y + (point.y - center.y) * factor
    }));
  }

  function offsetPolygon(points, requestedDistance, options = {}) {
    const originalArea = polygonArea(points);
    const orientation = originalArea >= 0 ? 1 : -1;
    const bounds = polygonBounds(points);
    const maximumInset = Math.max(
      options.minimumFeature || 0.03,
      Math.min(bounds.width, bounds.height) * finiteNumber(options.maximumInsetRatio, 0.42)
    );
    const distance = Math.max(requestedDistance, -maximumInset);
    if (Math.abs(distance) < EPSILON) return points.map(clonePoint);
    const miterLimit = Math.max(1.5, finiteNumber(options.miterLimit, 5));
    const result = [];

    for (let index = 0; index < points.length; index += 1) {
      const previous = points[(index - 1 + points.length) % points.length];
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const previousDirection = unitVector(previous, current);
      const nextDirection = unitVector(current, next);
      if (!previousDirection || !nextDirection) continue;
      const previousNormal = outwardNormal(previousDirection, orientation);
      const nextNormal = outwardNormal(nextDirection, orientation);
      const previousOffset = {
        x: current.x + previousNormal.x * distance,
        y: current.y + previousNormal.y * distance
      };
      const nextOffset = {
        x: current.x + nextNormal.x * distance,
        y: current.y + nextNormal.y * distance
      };
      const intersection = lineIntersection(
        previousOffset,
        previousDirection,
        nextOffset,
        nextDirection
      );
      const maximumMiter = Math.max(Math.abs(distance) * miterLimit, 0.08);
      if (intersection && Math.hypot(intersection.x - current.x, intersection.y - current.y) <= maximumMiter) {
        result.push(intersection);
      } else {
        result.push(previousOffset);
        if (squaredDistance(previousOffset, nextOffset) > 1e-10) result.push(nextOffset);
      }
    }

    const cleaned = cleanPolygon(result, 1e-7);
    const resultArea = polygonArea(cleaned);
    if (cleaned.length < 3
      || Math.abs(resultArea) < Math.abs(originalArea) * 0.002
      || Math.sign(resultArea || originalArea) !== Math.sign(originalArea)) {
      return cleanPolygon(radialOffsetFallback(points, distance), 1e-7);
    }
    return cleaned;
  }

  function polygonToCommands(points) {
    if (!points?.length) return [];
    return [
      { type: 'M', x: points[0].x, y: points[0].y },
      ...points.slice(1).map(point => ({ type: 'L', x: point.x, y: point.y })),
      { type: 'Z' }
    ];
  }

  function transformCommand(command, transformPoint) {
    if (command.type === 'M' || command.type === 'L') {
      const point = transformPoint(command);
      return { type: command.type, x: point.x, y: point.y };
    }
    if (command.type === 'C') {
      const control1 = transformPoint({ x: command.x1, y: command.y1 });
      const control2 = transformPoint({ x: command.x2, y: command.y2 });
      const point = transformPoint(command);
      return {
        type: 'C',
        x1: control1.x,
        y1: control1.y,
        x2: control2.x,
        y2: control2.y,
        x: point.x,
        y: point.y
      };
    }
    return { type: 'Z' };
  }

  /**
   * Produces weighted filled outlines. Weight 1 returns the original cubic
   * commands. Other weights are adaptively flattened and polygon-offset; the
   * offset result is then rescaled to the original ink bounds so the external
   * letter dimensions stay fixed.
   */
  function adjustWeight(source, requestedWeight, options = {}) {
    const vector = getVectorSource(source, options);
    if (!vector) throw new Error('No vector data is available for weight adjustment.');
    const weight = normalizedWeight(requestedWeight ?? vector.weight);
    const originalPaths = options.renderPaths || topologyRenderPaths(vector);
    const originalBounds = computePathBounds(originalPaths);
    if (Math.abs(weight - 1) < 1e-9 || originalBounds.width < EPSILON || originalBounds.height < EPSILON) {
      return {
        weight,
        flattened: false,
        paths: clonePaths(originalPaths),
        originalBounds: { ...originalBounds },
        bounds: { ...originalBounds },
        warnings: []
      };
    }

    const minimumDimension = Math.max(EPSILON, Math.min(originalBounds.width, originalBounds.height));
    const tolerance = Math.max(
      0.025,
      finiteNumber(options.flattenTolerance, minimumDimension * 0.003)
    );
    const nominalStrokeRatio = clamp(finiteNumber(options.nominalStrokeRatio, 0.18), 0.06, 0.36);
    const distance = (weight - 1) * minimumDimension * nominalStrokeRatio / 2;
    const warnings = [];
    const offsetEntries = [];

    for (const entry of originalPaths) {
      const polygons = flattenPathEntry(entry, tolerance);
      const contours = classifyContours(polygons, entry.rule);
      const commands = [];
      for (const contour of contours) {
        const contourDistance = contour.role === 'hole' ? -distance : distance;
        const offset = offsetPolygon(contour.points, contourDistance, options);
        if (offset.length < 3) {
          warnings.push(`Contour ${contour.index} could not be offset and was retained.`);
          commands.push(...polygonToCommands(contour.points));
        } else {
          commands.push(...polygonToCommands(offset));
        }
      }
      offsetEntries.push({ rule: entry.rule, commands });
    }

    const offsetBounds = computePathBounds(offsetEntries);
    if (offsetBounds.width < EPSILON || offsetBounds.height < EPSILON) {
      warnings.push('Offset geometry collapsed; the original outline was retained.');
      return {
        weight,
        flattened: false,
        paths: clonePaths(originalPaths),
        originalBounds: { ...originalBounds },
        bounds: { ...originalBounds },
        warnings
      };
    }
    const scaleX = originalBounds.width / offsetBounds.width;
    const scaleY = originalBounds.height / offsetBounds.height;
    const remap = point => ({
      x: originalBounds.left + (point.x - offsetBounds.left) * scaleX,
      y: originalBounds.top + (point.y - offsetBounds.top) * scaleY
    });
    const paths = offsetEntries.map(entry => ({
      rule: entry.rule,
      commands: entry.commands.map(command => transformCommand(command, remap))
    }));
    return {
      weight,
      flattened: true,
      paths,
      originalBounds: { ...originalBounds },
      bounds: computePathBounds(paths),
      warnings
    };
  }

  function getEffectivePathsInternal(vector, options = {}) {
    const weight = normalizedWeight(options.weight ?? vector.weight);
    const renderPaths = topologyRenderPaths(vector);
    if (Math.abs(weight - 1) < 1e-9) return renderPaths;
    const optionSignature = [
      finiteNumber(options.flattenTolerance, -1),
      finiteNumber(options.nominalStrokeRatio, -1),
      finiteNumber(options.maximumInsetRatio, -1),
      finiteNumber(options.minimumFeature, -1),
      finiteNumber(options.miterLimit, -1)
    ].join(',');
    const signature = `${vectorSignature(vector)}@${weight}@${optionSignature}`;
    const cached = effectivePathCache.get(vector);
    if (cached?.signature === signature) return cached.paths;
    const result = adjustWeight(vector, weight, { ...options, renderPaths });
    const frozen = deepFreezePaths(clonePaths(result.paths));
    effectivePathCache.set(vector, { signature, paths: frozen, warnings: result.warnings.slice() });
    return frozen;
  }

  function getEffectivePaths(source, options = {}) {
    const vector = getVectorSource(source, options);
    if (!vector) return [];
    return clonePaths(getEffectivePathsInternal(vector, options));
  }

  function getRenderVector(source, options = {}) {
    const vector = getVectorSource(source, options);
    if (!vector) return null;
    const paths = getEffectivePathsInternal(vector, options);
    return {
      schemaVersion: VECTOR_SCHEMA_VERSION,
      sourceKey: vector.sourceKey || '',
      letter: vector.letter || '',
      tradition: normalizeTradition(vector.tradition),
      style: vector.style || traditionToStyle(vector.tradition),
      slug: vector.slug || '',
      viewBox: vector.viewBox.slice(0, 4),
      weight: normalizedWeight(options.weight ?? vector.weight),
      paths: clonePaths(paths),
      bounds: computePathBounds(paths)
    };
  }

  function setVectorWeight(vector, requestedWeight) {
    if (!isVectorData(vector)) throw new TypeError('Editable vector data is required.');
    const weight = normalizedWeight(requestedWeight);
    if (Math.abs(normalizedWeight(vector.weight) - weight) < 1e-9) return weight;
    vector.weight = weight;
    touchVector(vector);
    return weight;
  }

  function setObjectWeight(object, requestedWeight, options = {}) {
    const vector = materializeObjectVector(object, options);
    const weight = setVectorWeight(vector, requestedWeight);
    object.letterWeight = weight;
    return {
      weight,
      vector,
      render: options.includeRender === false ? null : getRenderVector(vector, options)
    };
  }

  function objectRect(objectOrRect) {
    if (!objectOrRect || typeof objectOrRect !== 'object') {
      throw new TypeError('A letter object or rectangle is required.');
    }
    if (Array.isArray(objectOrRect.points) && objectOrRect.points.length) {
      const xs = objectOrRect.points.map(point => finiteNumber(point.x));
      const ys = objectOrRect.points.map(point => finiteNumber(point.y));
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      return { x: left, y: top, width: right - left, height: bottom - top, left, right, top, bottom };
    }
    const x = finiteNumber(objectOrRect.x ?? objectOrRect.left);
    const y = finiteNumber(objectOrRect.y ?? objectOrRect.top);
    const width = Math.max(EPSILON, finiteNumber(
      objectOrRect.width,
      finiteNumber(objectOrRect.right) - x
    ));
    const height = Math.max(EPSILON, finiteNumber(
      objectOrRect.height,
      finiteNumber(objectOrRect.bottom) - y
    ));
    return {
      x,
      y,
      width,
      height,
      left: x,
      right: x + width,
      top: y,
      bottom: y + height
    };
  }

  function resolveLayoutMode(object, requestedMode) {
    const mode = requestedMode || object?.template?.layoutMode || object?.layoutMode;
    return mode === LAYOUT_SOURCE_CELL ? LAYOUT_SOURCE_CELL : LAYOUT_TIGHT;
  }

  /**
   * Returns an axis-aligned affine mapping from asset-local vector coordinates
   * to image coordinates. In source-cell-v2 the object rectangle represents
   * the shared 61.910 × 64.164 board cell; ink may legally overshoot it.
   */
  function getLayoutTransform(object, options = {}) {
    const rect = objectRect(options.rect || object);
    const vector = getVectorSource(options.vector || object, options)
      || parseLegacyAssetInternal(options.asset || resolveLegacyAsset(object, options.tradition));
    const viewBox = vector.viewBox.slice(0, 4);
    const [viewX, viewY, viewWidth, viewHeight] = viewBox;
    const layoutMode = resolveLayoutMode(object, options.layoutMode);
    let scaleX;
    let scaleY;
    let translateX;
    let translateY;
    let canonicalRect;
    let metric = null;

    if (layoutMode === LAYOUT_SOURCE_CELL) {
      metric = getSourceMetrics(options.identity || object, options.tradition || vector.tradition);
      if (!metric) throw new Error('Source-cell metrics are unavailable for this letter.');
      canonicalRect = {
        x: 0,
        y: 0,
        width: metric.sourceCell.width,
        height: metric.sourceCell.height
      };
      scaleX = rect.width / Math.max(EPSILON, canonicalRect.width);
      scaleY = rect.height / Math.max(EPSILON, canonicalRect.height);
      /*
       * assetOriginInCell is where the asset viewBox origin sits inside the
       * source cell. The subtraction of viewX/viewY keeps non-zero viewBoxes
       * correct as well.
       */
      translateX = rect.x + (metric.assetOriginInCell.x - viewX) * scaleX;
      translateY = rect.y + (metric.assetOriginInCell.y - viewY) * scaleY;
    } else {
      canonicalRect = { x: viewX, y: viewY, width: viewWidth, height: viewHeight };
      scaleX = rect.width / Math.max(EPSILON, viewWidth);
      scaleY = rect.height / Math.max(EPSILON, viewHeight);
      translateX = rect.x - viewX * scaleX;
      translateY = rect.y - viewY * scaleY;
    }

    return {
      layoutMode,
      rect: { ...rect },
      viewBox,
      canonicalRect,
      metric,
      scaleX,
      scaleY,
      translateX,
      translateY,
      matrix: {
        a: scaleX,
        b: 0,
        c: 0,
        d: scaleY,
        e: translateX,
        f: translateY
      },
      localToImage(point) {
        return {
          x: finiteNumber(point?.x) * scaleX + translateX,
          y: finiteNumber(point?.y) * scaleY + translateY
        };
      },
      imageToLocal(point) {
        return {
          x: (finiteNumber(point?.x) - translateX) / Math.max(EPSILON, scaleX),
          y: (finiteNumber(point?.y) - translateY) / Math.max(EPSILON, scaleY)
        };
      }
    };
  }

  function localToImage(object, point, options = {}) {
    return getLayoutTransform(object, options).localToImage(point);
  }

  function imageToLocal(object, point, options = {}) {
    return getLayoutTransform(object, options).imageToLocal(point);
  }

  function transformBounds(bounds, transform) {
    const first = transform.localToImage({ x: bounds.left, y: bounds.top });
    const second = transform.localToImage({ x: bounds.right, y: bounds.bottom });
    const left = Math.min(first.x, second.x);
    const right = Math.max(first.x, second.x);
    const top = Math.min(first.y, second.y);
    const bottom = Math.max(first.y, second.y);
    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      left,
      top,
      right,
      bottom
    };
  }

  function getVisualBounds(object, options = {}) {
    const vector = getVectorSource(options.vector || object, options);
    if (!vector) return null;
    const paths = getEffectivePathsInternal(vector, options);
    const localBounds = computePathBounds(paths);
    const transform = getLayoutTransform(object, { ...options, vector });
    const imageBounds = transformBounds(localBounds, transform);
    return {
      layoutMode: transform.layoutMode,
      local: localBounds,
      image: imageBounds,
      objectRect: { ...transform.rect },
      extendsObjectRect: (
        imageBounds.left < transform.rect.left - EPSILON
        || imageBounds.right > transform.rect.right + EPSILON
        || imageBounds.top < transform.rect.top - EPSILON
        || imageBounds.bottom > transform.rect.bottom + EPSILON
      )
    };
  }

  function enumerateHandles(source, options = {}) {
    const vector = getVectorSource(source, options);
    if (!vector) return [];
    const handles = [];
    const transform = options.coordinateSpace === 'image' && source?.points
      ? getLayoutTransform(source, { ...options, vector })
      : null;
    const emit = (pathIndex, commandIndex, role, kind, point, organId = null) => {
      const local = clonePoint(point);
      const mapped = transform ? transform.localToImage(local) : local;
      handles.push({
        id: formatHandleId(pathIndex, commandIndex, role, organId),
        organId,
        pathIndex,
        commandIndex,
        role,
        kind,
        local,
        point: mapped,
        coordinateSpace: transform ? 'image' : 'local'
      });
    };

    const enumeratePaths = (paths, organId = null) => paths.forEach((entry, pathIndex) => {
      entry.commands.forEach((command, commandIndex) => {
        if (command.type === 'M' || command.type === 'L') {
          emit(pathIndex, commandIndex, 'anchor', 'anchor', command, organId);
        } else if (command.type === 'C') {
          /* C1 leaves the preceding anchor; C2 enters this command's anchor. */
          emit(pathIndex, commandIndex, 'control-out', 'control', { x: command.x1, y: command.y1 }, organId);
          emit(pathIndex, commandIndex, 'control-in', 'control', { x: command.x2, y: command.y2 }, organId);
          emit(pathIndex, commandIndex, 'anchor', 'anchor', command, organId);
        }
      });
    });
    enumeratePaths(topologyBasePaths(vector));
    for (const organ of topologyOrgans(vector)) enumeratePaths(organ.paths, organ.id);
    return handles;
  }

  function getHandleCounts(source, options = {}) {
    const vector = getVectorSource(source, options);
    if (!vector) return { anchors: 0, controls: 0, total: 0 };
    return calculateHandleCountsFromPaths(topologyEditablePaths(vector));
  }

  function contourRangeForCommand(commands, commandIndex) {
    let start = commandIndex;
    while (start > 0 && commands[start].type !== 'M') start -= 1;
    if (commands[start]?.type !== 'M') return null;
    let end = start + 1;
    while (end < commands.length && commands[end].type !== 'M') end += 1;
    return { start, end: end - 1 };
  }

  function adjacentControls(commands, commandIndex) {
    const range = contourRangeForCommand(commands, commandIndex);
    if (!range) return [];
    const controls = [];
    const command = commands[commandIndex];

    if (command.type === 'C') {
      controls.push({ commandIndex, coordinate: 'control-in' });
    }
    let nextIndex = commandIndex + 1;
    /* Raster vectors close with a linear Z edge; it has no outgoing cubic
       control. Do not borrow the first segment's control for the last anchor. */
    if (nextIndex > range.end || commands[nextIndex]?.type === 'Z') return controls;
    if (commands[nextIndex]?.type === 'C') {
      controls.push({ commandIndex: nextIndex, coordinate: 'control-out' });
    }
    const unique = new Map(controls.map(control => [
      `${control.commandIndex}:${control.coordinate}`,
      control
    ]));
    return [...unique.values()];
  }

  function moveVectorHandle(vector, handleId, targetLocal, options = {}) {
    if (!isVectorData(vector)) throw new TypeError('Editable vector data is required.');
    const handle = parseHandleId(handleId);
    const context = handlePathContext(vector, handle);
    const entry = context?.paths?.[handle.pathIndex];
    const command = entry?.commands?.[handle.commandIndex];
    if (!command) throw new RangeError(`Vector handle ${handleId} no longer exists.`);
    const target = clonePoint(targetLocal);
    let previous;

    if (handle.role === 'anchor') {
      if (!['M', 'L', 'C'].includes(command.type)) {
        throw new TypeError(`${handleId} is not an anchor command.`);
      }
      previous = { x: command.x, y: command.y };
      const delta = { x: target.x - previous.x, y: target.y - previous.y };
      command.x = target.x;
      command.y = target.y;
      if (options.moveAdjacentControls !== false) {
        for (const control of adjacentControls(entry.commands, handle.commandIndex)) {
          const adjacent = entry.commands[control.commandIndex];
          if (control.coordinate === 'control-out') {
            adjacent.x1 += delta.x;
            adjacent.y1 += delta.y;
          } else {
            adjacent.x2 += delta.x;
            adjacent.y2 += delta.y;
          }
        }
      }
    } else {
      if (command.type !== 'C') throw new TypeError(`${handleId} is not a cubic control.`);
      if (handle.role === 'control-out') {
        previous = { x: command.x1, y: command.y1 };
        command.x1 = target.x;
        command.y1 = target.y;
      } else {
        previous = { x: command.x2, y: command.y2 };
        command.x2 = target.x;
        command.y2 = target.y;
      }
    }
    touchVector(vector);
    return {
      id: handleId,
      role: handle.role,
      previous,
      point: target,
      delta: { x: target.x - previous.x, y: target.y - previous.y },
      revision: vector.revision,
      counts: { ...vector.handleCounts }
    };
  }

  function moveObjectHandle(object, handleId, targetImage, options = {}) {
    const vector = materializeObjectVector(object, options);
    const transform = getLayoutTransform(object, { ...options, vector });
    const targetLocal = transform.imageToLocal(targetImage);
    const result = moveVectorHandle(vector, handleId, targetLocal, options);
    return {
      ...result,
      local: result.point,
      point: transform.localToImage(result.point),
      coordinateSpace: 'image',
      vector
    };
  }

  function translateObjectHandles(object, handleIds, deltaImage, options = {}) {
    const ids = [...new Set((handleIds || []).map(String))];
    if (!ids.length) throw new TypeError('At least one vector handle id is required.');
    const vector = materializeObjectVector(object, options);
    const transform = getLayoutTransform(object, { ...options, vector });
    const localOrigin = transform.imageToLocal({ x: 0, y: 0 });
    const localTarget = transform.imageToLocal({
      x: finiteNumber(deltaImage?.x),
      y: finiteNumber(deltaImage?.y)
    });
    const delta = {
      x: localTarget.x - localOrigin.x,
      y: localTarget.y - localOrigin.y
    };
    const coordinates = new Map();
    const addCoordinate = (handle, commandIndex = handle.commandIndex, role = handle.role) => {
      const context = handlePathContext(vector, handle);
      const entry = context?.paths?.[handle.pathIndex];
      const command = entry?.commands?.[commandIndex];
      if (!command) return;
      let xKey;
      let yKey;
      if (role === 'anchor' && ['M', 'L', 'C'].includes(command.type)) {
        xKey = 'x';
        yKey = 'y';
      } else if (role === 'control-out' && command.type === 'C') {
        xKey = 'x1';
        yKey = 'y1';
      } else if (role === 'control-in' && command.type === 'C') {
        xKey = 'x2';
        yKey = 'y2';
      } else {
        return;
      }
      coordinates.set(`${handle.organId || 'base'}:${handle.pathIndex}:${commandIndex}:${xKey}`, { command, xKey, yKey });
    };

    const selectedAnchorIds = new Set(ids.filter(id => id.endsWith(':anchor')));
    const internalControl = (handle, control) => {
      if (!options.moveInternalControlsOnly) return true;
      if (control.coordinate === 'control-in') {
        const previousIndex = control.commandIndex - 1;
        return previousIndex >= 0 && selectedAnchorIds.has(formatHandleId(
          handle.pathIndex, previousIndex, 'anchor', handle.organId
        ));
      }
      if (control.coordinate === 'control-out') {
        return selectedAnchorIds.has(formatHandleId(
          handle.pathIndex, control.commandIndex, 'anchor', handle.organId
        ));
      }
      return false;
    };
    for (const id of ids) {
      const handle = parseHandleId(id);
      addCoordinate(handle);
      if (handle.role === 'anchor' && options.moveAdjacentControls !== false) {
        const commands = handlePathContext(vector, handle)?.paths?.[handle.pathIndex]?.commands || [];
        for (const control of adjacentControls(commands, handle.commandIndex)) {
          if (!internalControl(handle, control)) continue;
          addCoordinate(handle, control.commandIndex, control.coordinate);
        }
      }
    }
    for (const coordinate of coordinates.values()) {
      coordinate.command[coordinate.xKey] += delta.x;
      coordinate.command[coordinate.yKey] += delta.y;
    }
    touchVector(vector);
    return {
      ids,
      movedCoordinateCount: coordinates.size,
      delta,
      deltaImage: {
        x: finiteNumber(deltaImage?.x),
        y: finiteNumber(deltaImage?.y)
      },
      revision: vector.revision,
      counts: { ...vector.handleCounts },
      vector
    };
  }

  function tiltObjectHandles(object, handleIds, targetAngleDeg, options = {}) {
    const ids = [...new Set((handleIds || []).map(String))];
    if (ids.length < 2) throw new TypeError('At least two vector anchor ids are required for an axis tilt.');
    const vector = materializeObjectVector(object, options);
    const transform = getLayoutTransform(object, { ...options, vector });
    const selectedHandles = enumerateHandles(object, {
      ...options,
      vector,
      materialize: false,
      coordinateSpace: 'image'
    }).filter(handle => handle.kind === 'anchor' && ids.includes(handle.id));
    if (selectedHandles.length < 2) throw new TypeError('The selected vector feature does not contain two anchors.');

    const sorted = [...selectedHandles].sort((a, b) => a.point.y - b.point.y);
    const bandSize = Math.max(1, Math.ceil(sorted.length * .2));
    const averagePoint = handles => handles.reduce((sum, handle) => ({
      x: sum.x + handle.point.x / handles.length,
      y: sum.y + handle.point.y / handles.length
    }), { x: 0, y: 0 });
    const detectedRoot = averagePoint(sorted.slice(0, bandSize));
    const detectedTip = averagePoint(sorted.slice(-bandSize));
    const root = options.rootImage && Number.isFinite(+options.rootImage.x) && Number.isFinite(+options.rootImage.y)
      ? { x: +options.rootImage.x, y: +options.rootImage.y }
      : detectedRoot;
    const tip = options.tipImage && Number.isFinite(+options.tipImage.x) && Number.isFinite(+options.tipImage.y)
      ? { x: +options.tipImage.x, y: +options.tipImage.y }
      : detectedTip;
    const signedVerticalAngle = (a, b) => {
      let value = Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI;
      while (value > 90) value -= 180;
      while (value < -90) value += 180;
      return value;
    };
    const currentAngleDeg = Number.isFinite(+options.currentAngleDeg)
      ? +options.currentAngleDeg
      : signedVerticalAngle(root, tip);
    const target = clamp(finiteNumber(targetAngleDeg), -89, 89);
    const currentTangent = Math.tan(currentAngleDeg * Math.PI / 180);
    const targetTangent = Math.tan(target * Math.PI / 180);
    const transformMode = options.transformMode === 'rotate' || options.rigid === true
      ? 'rotate'
      : 'shear';
    const rotation = (target - currentAngleDeg) * Math.PI / 180;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const pivot = options.pivotImage && Number.isFinite(+options.pivotImage.x) && Number.isFinite(+options.pivotImage.y)
      ? { x: +options.pivotImage.x, y: +options.pivotImage.y }
      : root;

    const coordinates = new Map();
    const addCoordinate = (handle, commandIndex = handle.commandIndex, role = handle.role) => {
      const context = handlePathContext(vector, handle);
      const command = context?.paths?.[handle.pathIndex]?.commands?.[commandIndex];
      if (!command) return;
      let xKey;
      let yKey;
      if (role === 'anchor' && ['M', 'L', 'C'].includes(command.type)) {
        xKey = 'x'; yKey = 'y';
      } else if (role === 'control-out' && command.type === 'C') {
        xKey = 'x1'; yKey = 'y1';
      } else if (role === 'control-in' && command.type === 'C') {
        xKey = 'x2'; yKey = 'y2';
      } else return;
      coordinates.set(`${handle.organId || 'base'}:${handle.pathIndex}:${commandIndex}:${xKey}`, { command, xKey, yKey });
    };
    const selectedAnchorIds = new Set(ids.filter(id => id.endsWith(':anchor')));
    const internalControl = (handle, control) => {
      if (!options.moveInternalControlsOnly) return true;
      if (control.coordinate === 'control-in') {
        return selectedAnchorIds.has(formatHandleId(
          handle.pathIndex, control.commandIndex - 1, 'anchor', handle.organId
        ));
      }
      if (control.coordinate === 'control-out') {
        return selectedAnchorIds.has(formatHandleId(
          handle.pathIndex, control.commandIndex, 'anchor', handle.organId
        ));
      }
      return false;
    };
    for (const id of ids) {
      const handle = parseHandleId(id);
      if (handle.role !== 'anchor') continue;
      addCoordinate(handle);
      if (options.moveAdjacentControls !== false) {
        const commands = handlePathContext(vector, handle)?.paths?.[handle.pathIndex]?.commands || [];
        for (const control of adjacentControls(commands, handle.commandIndex)) {
          if (!internalControl(handle, control)) continue;
          addCoordinate(handle, control.commandIndex, control.coordinate);
        }
      }
    }
    for (const coordinate of coordinates.values()) {
      const image = transform.localToImage({
        x: coordinate.command[coordinate.xKey],
        y: coordinate.command[coordinate.yKey]
      });
      const relative = { x: image.x - pivot.x, y: image.y - pivot.y };
      const tiltedImage = transformMode === 'rotate'
        ? {
            x: pivot.x + relative.x * cosine - relative.y * sine,
            y: pivot.y + relative.x * sine + relative.y * cosine
          }
        : {
            x: image.x + (pivot.y - image.y) * (targetTangent - currentTangent),
            y: image.y
          };
      const local = transform.imageToLocal(tiltedImage);
      coordinate.command[coordinate.xKey] = local.x;
      coordinate.command[coordinate.yKey] = local.y;
    }
    touchVector(vector);
    const tipRelative = { x: tip.x - pivot.x, y: tip.y - pivot.y };
    const transformedTip = transformMode === 'rotate'
      ? {
          x: pivot.x + tipRelative.x * cosine - tipRelative.y * sine,
          y: pivot.y + tipRelative.x * sine + tipRelative.y * cosine
        }
      : {
          x: tip.x + (pivot.y - tip.y) * (targetTangent - currentTangent),
          y: tip.y
        };
    return {
      ids,
      movedCoordinateCount: coordinates.size,
      root,
      tip,
      pivot,
      currentAngleDeg,
      targetAngleDeg: target,
      transformMode,
      transformedTip,
      revision: vector.revision,
      counts: { ...vector.handleCounts },
      vector
    };
  }

  function hitTestHandle(object, imagePoint, options = {}) {
    const radius = Math.max(1, finiteNumber(options.radius, 14));
    const handles = enumerateHandles(object, {
      ...options,
      materialize: false,
      coordinateSpace: 'image'
    });
    let nearest = null;
    let nearestDistance = Infinity;
    for (const handle of handles) {
      const distance = Math.hypot(
        handle.point.x - finiteNumber(imagePoint?.x),
        handle.point.y - finiteNumber(imagePoint?.y)
      );
      if (distance <= radius && distance < nearestDistance) {
        nearest = handle;
        nearestDistance = distance;
      }
    }
    return nearest ? { ...nearest, distance: nearestDistance } : null;
  }

  function appendCommandsToPath2D(path, commands) {
    for (const command of commands || []) {
      if (command.type === 'M') path.moveTo(command.x, command.y);
      else if (command.type === 'L') path.lineTo(command.x, command.y);
      else if (command.type === 'C') {
        path.bezierCurveTo(
          command.x1,
          command.y1,
          command.x2,
          command.y2,
          command.x,
          command.y
        );
      } else if (command.type === 'Z') path.closePath();
    }
  }

  function clonePath2D(path, Constructor, commands) {
    try {
      return new Constructor(path);
    } catch {
      const clone = new Constructor();
      appendCommandsToPath2D(clone, commands);
      return clone;
    }
  }

  function path2DConstructorId(Constructor) {
    if (!path2DConstructorIds.has(Constructor)) {
      path2DConstructorIds.set(Constructor, nextPath2DConstructorId);
      nextPath2DConstructorId += 1;
    }
    return path2DConstructorIds.get(Constructor);
  }

  /**
   * Builds one Path2D per source SVG path so its fill rule remains explicit.
   * At weight 1 all cubic Bézier commands are retained exactly.
   */
  function buildPath2D(source, options = {}) {
    const Constructor = options.Path2D || globalThis.Path2D;
    const vector = getVectorSource(source, options);
    if (!vector) return { available: false, entries: [], viewBox: null, weight: 1 };
    const weight = normalizedWeight(options.weight ?? vector.weight);
    const paths = getEffectivePathsInternal(vector, { ...options, weight });
    if (typeof Constructor !== 'function') {
      return {
        available: false,
        entries: [],
        viewBox: vector.viewBox.slice(0, 4),
        weight,
        paths: options.includeCommands ? clonePaths(paths) : undefined
      };
    }

    const signature = `${vectorSignature(vector)}@${weight}@ctor${path2DConstructorId(Constructor)}#${commandSignature(paths)}`;
    const isLegacy = Object.isFrozen(vector);
    let cached;
    if (isLegacy) {
      const key = `${vector.sourceKey}:${signature}`;
      cached = legacyPath2DCache.get(key);
      if (!cached) {
        const entries = paths.map(entry => {
          const path = new Constructor();
          appendCommandsToPath2D(path, entry.commands);
          return Object.freeze({ path, rule: entry.rule });
        });
        cached = { signature, entries: Object.freeze(entries) };
        legacyPath2DCache.set(key, cached);
        trimMap(legacyPath2DCache, 96);
      }
    } else {
      cached = path2DCache.get(vector);
      if (cached?.signature !== signature) {
        const entries = paths.map(entry => {
          const path = new Constructor();
          appendCommandsToPath2D(path, entry.commands);
          return Object.freeze({ path, rule: entry.rule });
        });
        cached = { signature, entries: Object.freeze(entries) };
        path2DCache.set(vector, cached);
      }
    }

    const shared = options.shared === true;
    const entries = shared
      ? cached.entries
      : cached.entries.map((entry, index) => ({
        path: clonePath2D(entry.path, Constructor, paths[index].commands),
        rule: entry.rule
      }));
    return {
      available: true,
      entries,
      viewBox: vector.viewBox.slice(0, 4),
      weight,
      preservesBezier: Math.abs(weight - 1) < 1e-9,
      bounds: computePathBounds(paths)
    };
  }

  function hitTestFill(context, object, imagePoint, options = {}) {
    if (!context || typeof context.isPointInPath !== 'function') {
      throw new TypeError('A CanvasRenderingContext2D with isPointInPath is required.');
    }
    const vector = getVectorSource(object, options);
    if (!vector) return false;
    const local = imageToLocal(object, imagePoint, { ...options, vector });
    const built = buildPath2D(vector, {
      ...options,
      Path2D: options.Path2D || globalThis.Path2D,
      shared: true
    });
    if (!built.available) return false;
    return built.entries.some(entry => context.isPointInPath(
      entry.path,
      local.x,
      local.y,
      entry.rule
    ));
  }

  function stats(source, assetOrOptions = {}) {
    const options = assetOrOptions?.viewBox && Array.isArray(assetOrOptions?.paths)
      ? { asset: assetOrOptions }
      : (assetOrOptions || {});
    const vector = getVectorSource(source, options);
    if (!vector) {
      return {
        available: false,
        materialized: false,
        anchors: 0,
        controls: 0,
        totalHandles: 0
      };
    }
    const counts = getHandleCounts(vector);
    const effective = getEffectivePathsInternal(vector, options);
    const pathCount = vector.paths.length;
    const commandCount = vector.paths.reduce(
      (total, entry) => total + entry.commands.length,
      0
    );
    const cubicCount = vector.paths.reduce(
      (total, entry) => total + entry.commands.filter(command => command.type === 'C').length,
      0
    );
    const metric = getSourceMetrics(source, vector.tradition);
    let visualBounds = null;
    let layoutMode = resolveLayoutMode(source, options.layoutMode);
    if (source?.points || (
      Number.isFinite(source?.x)
      && Number.isFinite(source?.y)
      && Number.isFinite(source?.width)
      && Number.isFinite(source?.height)
    )) {
      visualBounds = getVisualBounds(source, { ...options, vector });
      layoutMode = visualBounds.layoutMode;
    }
    return {
      available: true,
      materialized: hasMaterializedVector(source),
      vectorProperty: VECTOR_PROPERTY,
      schemaVersion: vector.schemaVersion || VECTOR_SCHEMA_VERSION,
      sourceKey: vector.sourceKey || '',
      letter: vector.letter || identityFrom(source, vector.tradition).letter,
      tradition: normalizeTradition(vector.tradition),
      style: vector.style || traditionToStyle(vector.tradition),
      slug: vector.slug || '',
      layoutMode,
      weight: normalizedWeight(options.weight ?? vector.weight),
      viewBox: vector.viewBox.slice(0, 4),
      pathCount,
      commandCount,
      cubicCount,
      anchors: counts.anchors,
      controls: counts.controls,
      totalHandles: counts.total,
      localBounds: computePathBounds(effective),
      visualBounds,
      sourceMetrics: metric
    };
  }

  function exportPathData(source, options = {}) {
    const vector = getVectorSource(source, options);
    if (!vector) return [];
    const paths = getEffectivePathsInternal(vector, options);
    return paths.map(entry => ({
      d: serializePathData(entry.commands, options),
      rule: entry.rule
    }));
  }

  function clearCaches() {
    parsedAssetCache.clear();
    legacyPath2DCache.clear();
    effectivePathCache = new WeakMap();
    path2DCache = new WeakMap();
  }

  function getCacheInfo() {
    return {
      parsedLegacyAssets: parsedAssetCache.size,
      legacyPath2DEntries: legacyPath2DCache.size,
      editableCaches: 'weak'
    };
  }

  const api = {
    apiVersion: API_VERSION,
    vectorSchemaVersion: VECTOR_SCHEMA_VERSION,
    vectorProperty: VECTOR_PROPERTY,
    layouts: Object.freeze({
      tight: LAYOUT_TIGHT,
      sourceCell: LAYOUT_SOURCE_CELL
    }),
    weightRange: Object.freeze({ minimum: WEIGHT_MIN, maximum: WEIGHT_MAX }),
    sourceBoard: SOURCE_BOARD,
    ariOverrideLetters: ARI_OVERRIDE_LETTERS,
    normalizeTradition,
    resolveLegacyAsset,
    getSourceMetrics,
    listSourceMetrics,
    parsePathData,
    serializePathData,
    parseLegacyAsset,
    isVectorData,
    hasMaterializedVector,
    getObjectVector,
    getVectorSource,
    materializeObjectVector,
    cloneVectorData,
    migrateVectorData,
    invalidate,
    computePathBounds,
    adjustWeight,
    getEffectivePaths,
    getRenderVector,
    setVectorWeight,
    setObjectWeight,
    objectRect,
    resolveLayoutMode,
    getLayoutTransform,
    localToImage,
    imageToLocal,
    getVisualBounds,
    enumerateHandles,
    getHandleCounts,
    moveVectorHandle,
    moveObjectHandle,
    translateObjectHandles,
    tiltObjectHandles,
    hitTestHandle,
    buildPath2D,
    hitTestFill,
    stats,
    exportPathData,
    clearCaches,
    getCacheInfo
  };

  return Object.freeze(api);
})();
