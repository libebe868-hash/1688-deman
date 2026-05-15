(function (global) {
  'use strict';

  var DEFAULT_CONFIG = {
    dataJsonUrl: '',
    dataXlsxUrl: 'data.xlsx',
    sheetName: '',
    parseWorkerMinBytes: 262144,
    workerScript: 'workers/xlsx-worker.js',
    refetchOnMonthChange: false,
    initialFetchMonth: 'all'
  };

  var FIELD_ALIASES = {
    date: ['日期', '时间', 'date', 'day', '报表日期'],
    totalExp: ['总展现', '展现', '展现量', 'totalexp', '曝光', '曝光量'],
    adExp: ['广告展现', '广告曝光', 'adexp', '推广展现'],
    naturalExp: ['自然展现', '自然曝光', 'naturalexp', '免费展现'],
    visitors: ['访客', '访客数', 'visitors', '店铺访客'],
    inquiries: ['询盘', '询盘数', 'inquiries', '商机', '咨询'],
    reception: ['接待', '接待数', 'reception', '接待人数'],
    adSpend: ['广告花费', '花费', '推广花费', 'adspend', '消耗', '广告消耗'],
    leads: ['线索', '线索数', 'leads', '留资'],
    deals: ['成交金额', '成交额', '成交', '销售额', '营业额', 'deals', '金额'],
    dealCount: ['成交笔数', '订单数', '订单量', '笔数', 'dealcount', 'orders', '单数', '成交单数']
  };

  function normalizeHeader(s) {
    return String(s == null ? '' : s)
      .trim()
      .replace(/\s+/g, '')
      .replace(/[：:]/g, '')
      .toLowerCase();
  }

  function cellMatchesField(norm, field) {
    var list = FIELD_ALIASES[field];
    for (var i = 0; i < list.length; i++) {
      var a = normalizeHeader(list[i]);
      if (!a) continue;
      if (norm === a) return true;
    }
    for (var j = 0; j < list.length; j++) {
      var b = normalizeHeader(list[j]);
      if (b.length >= 2 && norm.indexOf(b) !== -1) return true;
    }
    return false;
  }

  function matchField(norm) {
    // 第一轮：精确匹配（防止「广告展现」因含「展现」被误判为 totalExp）
    for (var field in FIELD_ALIASES) {
      var list = FIELD_ALIASES[field];
      for (var i = 0; i < list.length; i++) {
        var a = normalizeHeader(list[i]);
        if (a && norm === a) return field;
      }
    }
    // 第二轮：模糊子串匹配（仅精确未命中时才退而求其次）
    for (var field2 in FIELD_ALIASES) {
      var list2 = FIELD_ALIASES[field2];
      for (var j = 0; j < list2.length; j++) {
        var b = normalizeHeader(list2[j]);
        if (b.length >= 2 && norm.indexOf(b) !== -1) return field2;
      }
    }
    return null;
  }

  function scoreHeaderRow(row) {
    if (!row || !row.length) return 0;
    var score = 0;
    var seen = {};
    for (var c = 0; c < row.length; c++) {
      var f = matchField(normalizeHeader(row[c]));
      if (f && !seen[f]) {
        seen[f] = true;
        score++;
      }
    }
    return score;
  }

  function detectLayout(rows) {
    var bestIdx = -1;
    var bestScore = 0;
    var maxScan = Math.min(6, rows.length);
    for (var r = 0; r < maxScan; r++) {
      var sc = scoreHeaderRow(rows[r]);
      if (sc > bestScore) {
        bestScore = sc;
        bestIdx = r;
      }
    }
    if (bestScore >= 2) {
      return { headerRowIndex: bestIdx, hasHeader: true, headerScore: bestScore };
    }
    return { headerRowIndex: 1, hasHeader: false, headerScore: 0 };
  }

  function buildColMap(headerRow) {
    var map = {};
    var extras = [];
    if (!headerRow) return { map: map, extras: extras, unknowns: [] };
    var unknowns = [];
    for (var c = 0; c < headerRow.length; c++) {
      var raw = headerRow[c];
      var norm = normalizeHeader(raw);
      var field = matchField(norm);
      if (field) {
        if (map[field] != null && map[field] !== c) {
          unknowns.push('列「' + raw + '」与已有「' + field + '」映射冲突');
        }
        map[field] = c;
      } else if (norm) {
        extras.push({ index: c, name: String(raw).trim() });
      }
    }
    return { map: map, extras: extras, unknowns: unknowns };
  }

  function excelToDate(serial) {
    var n = Number(serial);
    if (!isFinite(n) || n < 20000) return null;
    var utc_days = Math.floor(n - 25569);
    var date_info = new Date(utc_days * 86400 * 1000);
    return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate());
  }

  function parseMaybeDate(v, dateColFallback) {
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    if (typeof v === 'number' && isFinite(v)) {
      if (v > 20000 && v < 80000) return excelToDate(v);
    }
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    var d = new Date(s.replace(/\//g, '-'));
    if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return null;
  }

  function num(v) {
    if (v == null || v === '') return 0;
    var n = Number(String(v).replace(/,/g, '').replace(/[¥￥\s]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function legacyRowToRecord(row) {
    if (!row || !row[0] || isNaN(Number(row[0]))) return null;
    var dt = excelToDate(Number(row[0]));
    if (!dt) return null;
    return {
      date: dt,
      totalExp: num(row[1]),
      adExp: num(row[2]),
      naturalExp: num(row[3]),
      visitors: num(row[4]),
      inquiries: num(row[5]),
      reception: num(row[6]),
      adSpend: num(row[7]),
      leads: num(row[8]),
      deals: num(row[9]),
      dealCount: num(row[10]) || 0,
      extras: {}
    };
  }

  function mappedRowToRecord(row, colMap, extraCols) {
    var dc = colMap.date;
    if (dc == null) return null;
    var rawDate = row[dc];
    var dt = parseMaybeDate(rawDate, dc);
    if (!dt) return null;
    function pick(field, def) {
      var ix = colMap[field];
      if (ix == null) return def;
      return num(row[ix]);
    }
    var rec = {
      date: dt,
      totalExp: pick('totalExp', 0),
      adExp: pick('adExp', 0),
      naturalExp: pick('naturalExp', 0),
      visitors: pick('visitors', 0),
      inquiries: pick('inquiries', 0),
      reception: pick('reception', 0),
      adSpend: pick('adSpend', 0),
      leads: pick('leads', 0),
      deals: pick('deals', 0),
      dealCount: pick('dealCount', 0),
      extras: {}
    };
    for (var i = 0; i < extraCols.length; i++) {
      var ex = extraCols[i];
      var name = ex.name || '列' + ex.index;
      rec.extras[name] = num(row[ex.index]);
    }
    return rec;
  }

  /**
   * @returns {{ allData: object[], warnings: string[], meta: object }}
   */
  function parseRows(rows) {
    var warnings = [];
    if (!rows || rows.length < 2) {
      throw new Error('表格行数不足');
    }
    var layout = detectLayout(rows);
    var dataStart = layout.hasHeader ? layout.headerRowIndex + 1 : 2;
    var headerRow = layout.hasHeader ? rows[layout.headerRowIndex] : null;
    var colInfo = buildColMap(headerRow);
    colInfo.unknowns.forEach(function (u) {
      warnings.push(u);
    });
    if (headerRow) {
      colInfo.extras.forEach(function (ex) {
        warnings.push('扩展列（将纳入 extras）: 「' + ex.name + '」');
      });
    }

    var allData = [];
    var colMap = colInfo.map;

    if (layout.hasHeader && colMap.date == null) {
      throw new Error('已识别表头但未找到「日期」列，请对照 config 说明检查列名。');
    }

    if (!layout.hasHeader || colMap.date == null) {
      warnings.push('未识别到表头行或日期列，已按「第1列日期 + 固定列序」兼容旧表。');
      for (var r = dataStart; r < rows.length; r++) {
        var rec = legacyRowToRecord(rows[r]);
        if (rec && (rec.totalExp > 0 || rec.visitors > 0)) allData.push(rec);
      }
    } else {
      for (var r2 = dataStart; r2 < rows.length; r2++) {
        var row = rows[r2];
        if (!row || !row.length) continue;
        var rec2 = mappedRowToRecord(row, colMap, colInfo.extras);
        if (rec2 && (rec2.totalExp > 0 || rec2.visitors > 0 || rec2.inquiries > 0)) {
          allData.push(rec2);
        }
      }
    }

    allData.sort(function (a, b) {
      return a.date - b.date;
    });

    var meta = {
      layout: layout,
      extraColumnNames: colInfo.extras.map(function (e) {
        return e.name;
      }),
      mappedFields: Object.keys(colMap)
    };

    if (allData.length === 0) throw new Error('无有效数据行（需日期 + 展现/访客之一>0）');

    return { allData: allData, warnings: warnings, meta: meta };
  }

  function objectsToRows(data) {
    if (!data || !data.length) return [];
    if (Array.isArray(data[0])) return data;
    var keys = Object.keys(data[0]);
    var out = [keys];
    for (var i = 0; i < data.length; i++) {
      var row = [];
      for (var k = 0; k < keys.length; k++) {
        row.push(data[i][keys[k]]);
      }
      out.push(row);
    }
    return out;
  }

  function normalizeApiPayload(json) {
    if (json.rows && Array.isArray(json.rows)) return json.rows;
    if (json.data && Array.isArray(json.data)) return objectsToRows(json.data);
    if (Array.isArray(json)) return objectsToRows(json);
    throw new Error('接口 JSON 需包含 rows[][] 或 data[] 对象数组');
  }

  function mergeConfig(base, patch) {
    var o = {};
    for (var k in base) o[k] = base[k];
    if (patch) {
      for (var k2 in patch) {
        if (patch[k2] !== undefined && patch[k2] !== null) o[k2] = patch[k2];
      }
    }
    return o;
  }

  function parseXlsxInMainThread(arrayBuffer, sheetName) {
    var wb = XLSX.read(arrayBuffer, { type: 'array' });
    var name = sheetName && wb.SheetNames.indexOf(sheetName) >= 0 ? sheetName : wb.SheetNames[0];
    var sheet = wb.Sheets[name];
    if (!sheet) throw new Error('工作表为空');
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    return { rows: rows, sheetUsed: name };
  }

  function parseXlsxWithWorker(arrayBuffer, sheetName, workerUrl) {
    return new Promise(function (resolve, reject) {
      var w;
      try {
        w = new Worker(workerUrl);
      } catch (e) {
        reject(e);
        return;
      }
      w.onmessage = function (ev) {
        w.terminate();
        var d = ev.data;
        if (!d || !d.ok) reject(new Error((d && d.error) || 'Worker 解析失败'));
        else resolve({ rows: d.rows, sheetUsed: d.sheetUsed });
      };
      w.onerror = function (err) {
        try {
          w.terminate();
        } catch (e2) {}
        reject(err.error || err);
      };
      w.postMessage({ arrayBuffer: arrayBuffer, sheetName: sheetName || '' });
    });
  }

  global.HanhongData = {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    parseRows: parseRows,
    normalizeApiPayload: normalizeApiPayload,
    mergeConfig: mergeConfig,
    parseXlsxInMainThread: parseXlsxInMainThread,
    parseXlsxWithWorker: parseXlsxWithWorker,
    fetchMergedConfig: function () {
      return fetch('config.json?t=' + Date.now())
        .then(function (r) {
          if (!r.ok) return DEFAULT_CONFIG;
          return r.json();
        })
        .catch(function () {
          return DEFAULT_CONFIG;
        })
        .then(function (j) {
          return mergeConfig(DEFAULT_CONFIG, j);
        });
    }
  };
})(typeof window !== 'undefined' ? window : this);
