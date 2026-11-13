// 按CF约定把ragged数组装配成逐观测点的结构化记录。
// 规则：先判断填充值与有效范围再缩放，缺测码不得缩成正常值；
// 360_day等非公历时间保留原日历与数值，不硬转公历；
// 越界索引与计数不守恒隔离为可定位错误，不悄悄错位后继续发布。

const GREGORIAN_CALENDARS = new Set(['standard', 'gregorian', 'proleptic_gregorian']);
const COMMON_YEAR = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const LEAP_YEAR = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const CALENDAR_MONTHS = {
  '360_day': Array(12).fill(30),
  noleap: COMMON_YEAR,
  '365_day': COMMON_YEAR,
  all_leap: LEAP_YEAR,
  '366_day': LEAP_YEAR,
};
const UNIT_FACTORS = {
  day: 86400000, days: 86400000,
  hour: 3600000, hours: 3600000,
  minute: 60000, minutes: 60000,
  second: 1000, seconds: 1000,
  millisecond: 1, milliseconds: 1,
};

function attribute(variable, name) {
  return variable.attributes[name]?.value;
}
function numberList(variable, name) {
  const value = attribute(variable, name);
  return Array.isArray(value) ? value : [];
}
function scalar(variable, name) {
  const value = attribute(variable, name);
  return Array.isArray(value) ? value[0] : value;
}

// 先判填充值与有效范围，再对通过检查的原始值做缩放。
export function decodeSampled(variable, raw) {
  const fills = [...numberList(variable, '_FillValue'), ...numberList(variable, 'missing_value')];
  if (fills.includes(raw)) return { value: null, raw, missing: true };
  const range = numberList(variable, 'valid_range');
  const min = range.length === 2 ? range[0] : scalar(variable, 'valid_min');
  const max = range.length === 2 ? range[1] : scalar(variable, 'valid_max');
  if ((min !== undefined && raw < min) || (max !== undefined && raw > max)) {
    return { value: null, raw, invalid: true, reason: `原始值${raw}超出有效范围[${min ?? '-∞'},${max ?? '+∞'}]` };
  }
  const scale = scalar(variable, 'scale_factor') ?? 1;
  const offset = scalar(variable, 'add_offset') ?? 0;
  return { value: Number((raw * scale + offset).toPrecision(12)), raw };
}

function addCalendarDays(epoch, days, months) {
  const perYear = months.reduce((sum, length) => sum + length, 0);
  const yearOffset = Math.floor(days / perYear);
  let rest = days - yearOffset * perYear;
  let year = epoch.year + yearOffset;
  let month = epoch.month - 1;
  let day = epoch.day;
  while (rest > 0) {
    const remaining = months[month] - day;
    if (rest <= remaining) {
      day += rest;
      rest = 0;
    } else {
      rest -= remaining + 1;
      day = 1;
      month += 1;
      if (month === 12) {
        month = 0;
        year += 1;
      }
    }
  }
  return { year, month: month + 1, day };
}

function formatDate({ year, month, day }) {
  const pad = (value, width) => String(value).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

// 时间由units与calendar共同决定。公历族日历可给ISO瞬间；
// 360_day等日历只在其自身历法内分解日期，无法表达的保留原日历与数值。
export function decodeTime(units, calendar, value) {
  const base = { value, units, calendar: calendar ?? 'standard' };
  const match = /^\s*(\w+)\s+since\s+(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?\s*$/.exec(String(units ?? ''));
  if (!match) return { ...base, error: `时间units无法解析: ${units}` };
  const [, unit, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  const epoch = {
    year: Number(year), month: Number(month), day: Number(day),
    hour: Number(hour), minute: Number(minute), second: Number(second),
  };
  if (GREGORIAN_CALENDARS.has(base.calendar.toLowerCase())) {
    const factor = UNIT_FACTORS[unit];
    if (factor === undefined) return { ...base, error: `不支持的时间单位: ${unit}` };
    const instant = new Date(Date.UTC(epoch.year, epoch.month - 1, epoch.day, epoch.hour, epoch.minute, epoch.second));
    instant.setUTCFullYear(epoch.year);
    const ms = instant.getTime() + value * factor;
    const date = new Date(ms);
    if (!Number.isFinite(ms) || Number.isNaN(date.getTime())) return { ...base, error: '时间超出可表达范围' };
    return { ...base, iso: date.toISOString() };
  }
  const months = CALENDAR_MONTHS[base.calendar];
  if (months && (unit === 'day' || unit === 'days') && Number.isInteger(value)) {
    return { ...base, date: formatDate(addCalendarDays(epoch, value, months)) };
  }
  return { ...base, error: `日历${base.calendar}下无法表达该时间，保留原日历与数值` };
}

// 按CF约定识别ragged表示：sample_dimension为连续计数，instance_dimension为索引指回。
export function detectRagged(dataset) {
  const names = dataset.dimensions.map(dimension => dimension.name);
  for (const variable of dataset.variables) {
    const sample = scalar(variable, 'sample_dimension');
    if (typeof sample === 'string' && names.includes(sample)) {
      if (variable.dimensions.length !== 1) throw new Error(`计数变量${variable.name}不是一维`);
      return {
        kind: 'contiguous',
        variable: variable.name,
        instanceDimension: names[variable.dimensions[0]],
        sampleDimension: sample,
      };
    }
    const instance = scalar(variable, 'instance_dimension');
    if (typeof instance === 'string' && names.includes(instance)) {
      if (variable.dimensions.length !== 1) throw new Error(`索引变量${variable.name}不是一维`);
      return {
        kind: 'indexed',
        variable: variable.name,
        instanceDimension: instance,
        sampleDimension: names[variable.dimensions[0]],
      };
    }
  }
  throw new Error('未找到sample_dimension或instance_dimension属性，无法识别ragged表示');
}

function fieldName(variable) {
  if (scalar(variable, 'cf_role') === 'profile_id') return 'profile';
  const units = scalar(variable, 'units');
  if (units === 'degrees_north') return 'latitude';
  if (units === 'degrees_east') return 'longitude';
  if (variable.name === 'stationId') return 'station';
  return variable.name;
}

function decodeField(variable, raw) {
  const units = scalar(variable, 'units');
  if (typeof units === 'string' && /\bsince\b/.test(units)) {
    return { value: decodeTime(units, scalar(variable, 'calendar'), raw) };
  }
  const meanings = attribute(variable, 'flag_meanings');
  if (typeof meanings === 'string') {
    return { value: { flag: raw, meaning: meanings.trim().split(/\s+/)[raw] ?? null } };
  }
  const packed = ['_FillValue', 'missing_value', 'valid_range', 'valid_min', 'valid_max', 'scale_factor', 'add_offset']
    .some(name => attribute(variable, name) !== undefined);
  if (packed) return decodeSampled(variable, raw);
  return { value: raw };
}

// 装配逐观测记录。每个变量按chunkSize切片受控读取，读取痕迹写入reads；
// 每条记录的provenance给出字段来源的变量路径与元素索引。
export function collectObservations(dataset, { chunkSize = 100000 } = {}) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error('chunkSize必须为正整数');
  const ragged = detectRagged(dataset);
  const indexOf = name => dataset.dimensions.findIndex(dimension => dimension.name === name);
  const instanceDim = indexOf(ragged.instanceDimension);
  const sampleDim = indexOf(ragged.sampleDimension);
  const instanceSize = dataset.dimensions[instanceDim].size;
  const sampleSize = dataset.dimensions[sampleDim].size;
  const reads = [];
  const readSliced = name => {
    const variable = dataset.variables.find(item => item.name === name);
    const total = variable.dimensions.reduce((product, dim) => product * dataset.dimensions[dim].size, 1);
    const values = [];
    for (let start = 0; start < total; start += chunkSize) {
      const count = Math.min(chunkSize, total - start);
      values.push(...dataset.readVariable(name, start, count));
      reads.push({ variable: name, start, count });
    }
    return values;
  };

  // 先读结构变量，建立观测元素到剖面的归属；结构损坏时不继续读观测数据。
  const errors = [];
  let assignment = null;
  if (ragged.kind === 'contiguous') {
    const counts = readSliced(ragged.variable);
    const declared = counts.reduce((sum, count) => sum + (Number.isInteger(count) && count > 0 ? count : 0), 0);
    const mapping = new Array(sampleSize).fill(null);
    let cursor = 0;
    let broken = false;
    counts.forEach((count, index) => {
      if (broken) return;
      if (!Number.isInteger(count) || count < 0) {
        errors.push({ code: 'count-invalid', variable: ragged.variable, index, value: count, message: `剖面${index}的观测计数${count}非法` });
        broken = true;
        return;
      }
      if (count === 0) return; // 合法的零次观测剖面
      if (cursor + count > sampleSize) {
        errors.push({
          code: 'count-overflow', variable: ragged.variable, index, value: count,
          start: cursor, remaining: sampleSize - cursor, declared, sampleSize,
          message: `剖面${index}声明${count}条观测，剩余可分配仅${sampleSize - cursor}条`,
        });
        broken = true;
        return;
      }
      for (let offset = 0; offset < count; offset++) mapping[cursor + offset] = index;
      cursor += count;
    });
    if (!broken && cursor !== sampleSize) {
      errors.push({
        code: 'count-mismatch', variable: ragged.variable, declared: cursor, sampleSize, unassignedStart: cursor,
        message: `观测计数合计${cursor}与样本维长度${sampleSize}不一致`,
      });
      broken = true;
    }
    if (!broken) assignment = mapping;
  } else {
    const indices = readSliced(ragged.variable);
    const mapping = new Array(sampleSize).fill(null);
    indices.forEach((instance, index) => {
      if (!Number.isInteger(instance) || instance < 0 || instance >= instanceSize) {
        errors.push({
          code: 'index-out-of-range', variable: ragged.variable, index, value: instance, instanceSize,
          message: `观测${index}的索引${instance}超出剖面维[0,${instanceSize})`,
        });
        return; // 仅隔离该观测元素，其余归属不受影响
      }
      mapping[index] = instance;
    });
    assignment = mapping;
  }

  const instanceVars = dataset.variables.filter(variable =>
    variable.dimensions.length === 1 && variable.dimensions[0] === instanceDim && variable.name !== ragged.variable);
  const sampleVars = dataset.variables.filter(variable =>
    variable.dimensions.length === 1 && variable.dimensions[0] === sampleDim && variable.name !== ragged.variable);
  const instanceData = Object.fromEntries(instanceVars.map(variable => [variable.name, readSliced(variable.name)]));
  const sampleData = assignment
    ? Object.fromEntries(sampleVars.map(variable => [variable.name, readSliced(variable.name)]))
    : {};

  const profiles = [];
  for (let index = 0; index < instanceSize; index++) {
    const entry = {};
    for (const variable of instanceVars) entry[fieldName(variable)] = instanceData[variable.name][index];
    if (assignment) entry.observations = assignment.filter(target => target === index).length;
    profiles.push(entry);
  }

  const observations = [];
  if (assignment) {
    for (let element = 0; element < sampleSize; element++) {
      const instance = assignment[element];
      if (instance === null) continue; // 越界索引的观测已隔离到errors
      const record = {};
      const provenance = {};
      const missing = [];
      const invalid = [];
      for (const variable of instanceVars) {
        const field = fieldName(variable);
        record[field] = instanceData[variable.name][instance];
        provenance[field] = { variable: variable.name, index: instance };
      }
      for (const variable of sampleVars) {
        const field = fieldName(variable);
        const decoded = decodeField(variable, sampleData[variable.name][element]);
        record[field] = decoded.value;
        if (decoded.missing) missing.push(field);
        if (decoded.invalid) invalid.push({ field, variable: variable.name, index: element, raw: decoded.raw, reason: decoded.reason });
        provenance[field] = { variable: variable.name, index: element };
      }
      if (missing.length) record.missing = missing;
      if (invalid.length) record.invalid = invalid;
      record.provenance = provenance;
      observations.push(record);
    }
  }

  return {
    conventions: dataset.attributes.Conventions?.value ?? null,
    featureType: dataset.attributes.featureType?.value ?? null,
    representation: ragged.kind,
    raggedVariable: ragged.variable,
    instanceDimension: ragged.instanceDimension,
    sampleDimension: ragged.sampleDimension,
    complete: errors.length === 0,
    profiles,
    observations,
    errors,
    reads,
  };
}
