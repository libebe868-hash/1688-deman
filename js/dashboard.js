(function () {
  'use strict';

  var cfg = {};
  var allData = [];
  var currentMonth = '';
  var monthCatalog = [];
  var chartObserver = null;
  var lastParseWarnings = [];
  var renderContext = null;

  var CHART_IDS = [
    'trendChart',
    'pieChart',
    'weeklyChart',
    'funnelChart',
    'monthlyChart',
    'heatmapChart',
    'naturalFlowChart',
    'adSpendChart',
    'leadsChart',
    'dealsChart',
    'spendVsDealsChart',
    'receptionTrendChart'
  ];

  function destroyAllCharts() {
    CHART_IDS.forEach(function (id) {
      var ch = Chart.getChart(id);
      if (ch) ch.destroy();
    });
  }

  function disconnectChartObserver() {
    if (chartObserver) {
      chartObserver.disconnect();
      chartObserver = null;
    }
  }

  function format(date, fmt) {
    if (fmt === 'yyyy-MM') {
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    }
    if (fmt === 'MM-dd') {
      return String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }
    return date.toISOString().slice(0, 10);
  }

  // 杩斿洖 ISO 8601 鍛ㄩ敭 "YYYY-Www"锛堝懆涓€涓鸿捣濮嬶級
  function getISOWeekKey(date) {
    var d = new Date(date.getTime());
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    var yearStart = new Date(d.getFullYear(), 0, 1);
    var weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return d.getFullYear() + '-W' + String(weekNo).padStart(2, '0');
  }

  function predictFuture(data, key, days) {
    days = days || 7;
    if (data.length < 2) return Array(days).fill(0);
    var x = data.map(function (_, i) {
      return i;
    });
    var y = data.map(function (d) {
      return d[key];
    });
    var n = x.length;
    var sumX = x.reduce(function (a, b) {
      return a + b;
    }, 0);
    var sumY = y.reduce(function (a, b) {
      return a + b;
    }, 0);
    var sumXY = x.reduce(function (a, b, i) {
      return a + b * y[i];
    }, 0);
    var sumX2 = x.reduce(function (a, b) {
      return a + b * b;
    }, 0);
    var slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    var intercept = (sumY - slope * sumX) / n;
    var predictions = [];
    for (var i = n; i < n + days; i++) {
      predictions.push(Math.max(0, Math.round(slope * i + intercept)));
    }
    return predictions;
  }

  function reduceTotals(displayData) {
    return displayData.reduce(
      function (acc, d) {
        return {
          totalExp: acc.totalExp + d.totalExp,
          visitors: acc.visitors + d.visitors,
          inquiries: acc.inquiries + d.inquiries,
          reception: acc.reception + d.reception,
          adExp: acc.adExp + d.adExp,
          naturalExp: acc.naturalExp + d.naturalExp,
          adSpend: acc.adSpend + d.adSpend,
          leads: acc.leads + d.leads,
          deals: acc.deals + d.deals,
          dealCount: acc.dealCount + (d.dealCount || 0)
        };
      },
      {
        totalExp: 0,
        visitors: 0,
        inquiries: 0,
        reception: 0,
        adExp: 0,
        naturalExp: 0,
        adSpend: 0,
        leads: 0,
        deals: 0,
        dealCount: 0
      }
    );
  }

  function html2canvasPdfOptions() {
    return { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true };
  }

  function assertPdfLibs() {
    if (typeof html2canvas === 'undefined') {
      alert('html2canvas 鏈姞杞斤紝璇锋鏌ョ綉缁滃悗鍒锋柊椤甸潰銆?);
      return false;
    }
    if (typeof jspdf === 'undefined' || !jspdf.jsPDF) {
      alert('jsPDF 鏈姞杞斤紝璇锋鏌ョ綉缁滃悗鍒锋柊椤甸潰銆?);
      return false;
    }
    return true;
  }

  // 鏅鸿兘鍒嗛〉锛氬湪A4杈圭晫闄勮繎鎵弿绌虹櫧琛岋紝閬垮厤鍒囨柇鍥捐〃鎴栬〃鏍艰
  async function pdfSmartMultipage(pdf, canvas, pdfW, pdfH) {
    var scale = canvas.width / pdfW;
    var pageHpx = Math.round(pdfH * scale);
    var totalHpx = canvas.height;
    var W = canvas.width;
    // 涓€娆℃€ц鍙栧叏閮ㄥ儚绱?
    var fullData = canvas.getContext('2d').getImageData(0, 0, W, totalHpx).data;
    function rowWhite(y) {
      var nonWhite = 0;
      var base = y * W * 4;
      for (var xi = 0; xi < W; xi++) {
        var i4 = base + xi * 4;
        if (fullData[i4] < 235 || fullData[i4+1] < 235 || fullData[i4+2] < 235) nonWhite++;
      }
      return nonWhite / W < 0.05; // 灏戜簬5%闈炵櫧鍍忕礌瑙嗕负绌虹櫧琛?
    }
    var pageStart = 0;
    var pageNum = 0;
    while (pageStart < totalHpx) {
      var idealEnd = pageStart + pageHpx;
      var pageEnd;
      if (idealEnd >= totalHpx) {
        pageEnd = totalHpx;
      } else {
        pageEnd = idealEnd;
        // 鍚戜笂鏈€澶氭壂鎻?0mm鎵惧埌绌虹櫧琛?
        var scanLimit = Math.max(pageStart + Math.round(pageHpx * 0.55), idealEnd - Math.round(scale * 60));
        for (var sy = idealEnd; sy >= scanLimit; sy--) {
          if (rowWhite(sy)) { pageEnd = sy; break; }
        }
      }
      var sliceHpx = pageEnd - pageStart;
      var tmpC = document.createElement('canvas');
      tmpC.width = W;
      tmpC.height = sliceHpx;
      tmpC.getContext('2d').drawImage(canvas, 0, pageStart, W, sliceHpx, 0, 0, W, sliceHpx);
      var slicePdfH = Math.ceil(sliceHpx / scale);
      if (pageNum > 0) pdf.addPage();
      pdf.addImage(tmpC.toDataURL('image/png'), 'PNG', 0, 0, pdfW, slicePdfH);
      pageStart = pageEnd;
      pageNum++;
    }
  }

  // 閫氱敤澶氶€夊璇濇锛岃繑鍥?Promise<string[]|null>
  function showPickerDialog(title, items) {
    return new Promise(function(resolve) {
      var dlg = document.createElement('div');
      dlg.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
      var box = document.createElement('div');
      box.style.cssText = 'background:#fff;padding:24px 28px;border-radius:12px;min-width:300px;max-width:520px;max-height:78vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.3);font-family:Microsoft YaHei,Arial,sans-serif;color:#1a1a2e;';
      var titleDiv = document.createElement('div');
      titleDiv.style.cssText = 'font-size:17px;font-weight:bold;margin-bottom:12px;';
      titleDiv.textContent = title;
      box.appendChild(titleDiv);
      var allRow = document.createElement('div');
      allRow.style.cssText = 'margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #eee;';
      var allLbl = document.createElement('label');
      allLbl.style.cssText = 'cursor:pointer;font-size:13px;color:#555;display:flex;align-items:center;gap:6px;';
      var allChk = document.createElement('input'); allChk.type='checkbox'; allChk.checked=true;
      allLbl.appendChild(allChk); allLbl.appendChild(document.createTextNode('鍏ㄩ€?/ 鍏ㄤ笉閫?));
      allRow.appendChild(allLbl); box.appendChild(allRow);
      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-bottom:18px;';
      var cbs = [];
      items.forEach(function(item) {
        var lbl = document.createElement('label');
        lbl.style.cssText = 'cursor:pointer;font-size:13px;padding:7px 10px;border:1px solid #dde;border-radius:6px;display:flex;align-items:center;gap:6px;background:#e8f0ff;';
        var chk = document.createElement('input'); chk.type='checkbox'; chk.value=item; chk.checked=true;
        chk.addEventListener('change', function() {
          lbl.style.background = chk.checked ? '#e8f0ff' : '#f9f9f9';
          allChk.checked = cbs.every(function(c){return c.checked;});
          allChk.indeterminate = !allChk.checked && cbs.some(function(c){return c.checked;});
        });
        lbl.appendChild(chk); lbl.appendChild(document.createTextNode(item)); grid.appendChild(lbl); cbs.push(chk);
      });
      allChk.addEventListener('change', function() {
        cbs.forEach(function(c){ c.checked=allChk.checked; c.parentElement.style.background=allChk.checked?'#e8f0ff':'#f9f9f9'; });
      });
      box.appendChild(grid);
      var btnRow = document.createElement('div'); btnRow.style.cssText='display:flex;gap:12px;';
      var btnOk = document.createElement('button'); btnOk.textContent='鉁?纭涓嬭浇';
      btnOk.style.cssText='flex:1;padding:10px;background:#1a1a2e;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;';
      var btnCancel = document.createElement('button'); btnCancel.textContent='鍙栨秷';
      btnCancel.style.cssText='flex:1;padding:10px;background:#eee;color:#333;border:none;border-radius:8px;font-size:15px;cursor:pointer;';
      btnRow.appendChild(btnOk); btnRow.appendChild(btnCancel); box.appendChild(btnRow); dlg.appendChild(box); document.body.appendChild(dlg);
      btnOk.onclick = function() {
        var sel = cbs.filter(function(c){return c.checked;}).map(function(c){return c.value;});
        document.body.removeChild(dlg); resolve(sel.length ? sel : null);
      };
      btnCancel.onclick = function() { document.body.removeChild(dlg); resolve(null); };
    });
  }

  function showParseWarnings() {
    var el = document.getElementById('dataWarnings');
    if (!el) return;
    if (!lastParseWarnings.length) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.style.display = 'block';
    el.innerHTML =
      '<strong>鏁版嵁瑙ｆ瀽鎻愮ず</strong>锛? +
      lastParseWarnings.length +
      ' 鏉★級<br>' +
      lastParseWarnings.map(function (w) {
        return '路 ' + w;
      }).join('<br>');
  }

  function resolveJsonUrlWithMonth(url, monthToken) {
    if (!url) return '';
    if (url.indexOf('{month}') === -1) return url;
    var token = monthToken === '' || monthToken == null ? 'all' : monthToken;
    return url.split('{month}').join(encodeURIComponent(token));
  }

  function applyViewMonth(month) {
    currentMonth = month;
    var sel = document.querySelector('.month-select');
    if (sel) sel.value = month;
    renderAll();
  }

  async function refetchMonthData(month) {
    var jsonUrl = resolveJsonUrlWithMonth(cfg.dataJsonUrl, month);
    var sep = jsonUrl.indexOf('?') >= 0 ? '&' : '?';
    var jr = await fetch(jsonUrl + sep + 't=' + Date.now(), { headers: { Accept: 'application/json' } });
    if (!jr.ok) throw new Error('JSON 鎺ュ彛 ' + jr.status);
    var json = await jr.json();
    var rows = HanhongData.normalizeApiPayload(json);
    var pr = HanhongData.parseRows(rows);
    allData = pr.allData;
    lastParseWarnings = pr.warnings || [];
    showParseWarnings();
    renderAll();
  }

  async function loadData() {
    var loadingEl = document.getElementById('loading');
    loadingEl.style.display = 'block';
    loadingEl.innerHTML = '鍔犺浇鏁版嵁涓?..';
    var statsEl = document.getElementById('stats'); if (statsEl) statsEl.style.display = 'none';
    var chartsEl = document.getElementById('charts'); if (chartsEl) chartsEl.style.display = 'none';
    lastParseWarnings = [];

    try {
      cfg = await HanhongData.fetchMergedConfig();
      var rows;

      if (cfg.dataJsonUrl) {
        var jsonUrl = cfg.dataJsonUrl;
        if (jsonUrl.indexOf('{month}') >= 0) {
          jsonUrl = resolveJsonUrlWithMonth(jsonUrl, cfg.initialFetchMonth != null ? cfg.initialFetchMonth : 'all');
        }
        var sep = jsonUrl.indexOf('?') >= 0 ? '&' : '?';
        var jr = await fetch(jsonUrl + sep + 't=' + Date.now(), {
          headers: { Accept: 'application/json' }
        });
        if (!jr.ok) throw new Error('JSON 鎺ュ彛 ' + jr.status);
        var json = await jr.json();
        rows = HanhongData.normalizeApiPayload(json);
      } else {
        var url = cfg.dataXlsxUrl || 'data.xlsx';
        var response = await fetch(url + '?t=' + Date.now());
        if (!response.ok) throw new Error(url + ' 鏈壘鍒?(' + response.status + ')');
        var arrayBuffer = await response.arrayBuffer();
        var useWorker = arrayBuffer.byteLength >= (cfg.parseWorkerMinBytes || 262144);
        var parsed;
        if (useWorker && cfg.workerScript) {
          try {
            parsed = await HanhongData.parseXlsxWithWorker(arrayBuffer, cfg.sheetName || '', cfg.workerScript);
          } catch (werr) {
            parsed = HanhongData.parseXlsxInMainThread(arrayBuffer, cfg.sheetName || '');
          }
        } else {
          parsed = HanhongData.parseXlsxInMainThread(arrayBuffer, cfg.sheetName || '');
        }
        rows = parsed.rows;
      }

      var pr = HanhongData.parseRows(rows);
      allData = pr.allData;
      lastParseWarnings = pr.warnings || [];
      showParseWarnings();

      monthCatalog = Array.from(
        new Set(
          allData.map(function (d) {
            return format(d.date, 'yyyy-MM');
          })
        )
      ).sort();

      loadingEl.textContent = '宸插姞杞?' + allData.length + ' 澶╂暟鎹?;
      initMonthSelector();
      var latestMonth = format(allData[allData.length - 1].date, 'yyyy-MM');
      applyViewMonth(latestMonth);
    } catch (e) {
      loadingEl.innerHTML =
        '<span style="color:#ff6b9d">鍔犺浇澶辫触锛? +
        (e && e.message ? e.message : String(e)) +
        '</span><br><br>' +
        '<button type="button" class="btn" onclick="loadData()">閲嶈瘯</button>';
    }
  }

  function initMonthSelector() {
    var months = monthCatalog.length
      ? monthCatalog.slice()
      : Array.from(
          new Set(
            allData.map(function (d) {
              return format(d.date, 'yyyy-MM');
            })
          )
        ).sort();
    var container = document.getElementById('monthSelector');
    container.innerHTML = '<strong style="color:#00ffff; margin-right:10px;">鏈堜唤鍒囨崲锛?/strong>';
    var select = document.createElement('select');
    select.className = 'month-select';
    select.setAttribute('aria-label', '閫夋嫨缁熻鏈堜唤');
    var allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = '鍏ㄩ儴鏃堕棿';
    select.appendChild(allOpt);
    months.forEach(function (m) {
      var option = document.createElement('option');
      option.value = m;
      option.textContent = m;
      select.appendChild(option);
    });
    select.onchange = function () {
      switchMonth(this.value);
    };
    container.appendChild(select);
    select.value = months[months.length - 1] || '';
  }

  function switchMonth(month) {
    if (cfg && cfg.dataJsonUrl && cfg.refetchOnMonthChange && cfg.dataJsonUrl.indexOf('{month}') >= 0) {
      currentMonth = month;
      var sel = document.querySelector('.month-select');
      if (sel) sel.value = month;
      refetchMonthData(month).catch(function (err) {
        alert('鎸夋湀鎷夊彇澶辫触锛? + (err && err.message ? err.message : String(err)));
      });
      return;
    }
    applyViewMonth(month);
  }

  function safeText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function updateKpiDom(displayData, total) {
    var convRate = total.visitors > 0 ? total.inquiries / total.visitors * 100 : 0;
    var clickRate = total.totalExp > 0 ? total.visitors / total.totalExp * 100 : 0;
    var receptionRate = total.inquiries > 0 ? total.reception / total.inquiries * 100 : 0;

    var momInq = '鈥?;
    if (currentMonth) {
      var currentDate = new Date(currentMonth + '-01');
      var lastMonthYear = currentDate.getFullYear();
      var lastMonthMonth = currentDate.getMonth();
      if (lastMonthMonth === 0) {
        lastMonthMonth = 12;
        lastMonthYear--;
      } else {
        lastMonthMonth--;
      }
      var lastMonth = lastMonthYear + '-' + String(lastMonthMonth + 1).padStart(2, '0');
      var lastMonthData = allData.filter(function (d) {
        return format(d.date, 'yyyy-MM') === lastMonth;
      });
      var lastTotal = lastMonthData.reduce(
        function (acc, d) {
          return { inquiries: acc.inquiries + d.inquiries };
        },
        { inquiries: 0 }
      );
      if (lastTotal.inquiries > 0) {
        momInq = ((total.inquiries / lastTotal.inquiries - 1) * 100).toFixed(2) + '%';
      } else if (total.inquiries > 0) {
        momInq = '鈭?';
      } else {
        momInq = '0%';
      }
    }

    var roi = total.adSpend > 0 ? ((total.deals / total.adSpend) * 100).toFixed(2) + '%' : '0%';
    var costPerLead = total.leads > 0 ? (total.adSpend / total.leads).toFixed(2) : '0';
    var totalDealCount = total.dealCount || 0;

    safeText('totalExp', total.totalExp.toLocaleString());
    safeText('totalVis', total.visitors.toLocaleString());
    safeText('totalInq', total.inquiries);
    safeText('totalRec', total.reception);
    safeText('convRate', convRate.toFixed(2) + '%');
    safeText('adRate', total.totalExp > 0 ? ((total.adExp / total.totalExp) * 100).toFixed(1) + '%' : '0%');
    safeText('momInq', momInq);
    safeText('clickRate', clickRate.toFixed(2) + '%');
    safeText('totalAdSpend', total.adSpend.toFixed(2));
    safeText('totalLeads', total.leads);
    safeText('totalDeals', total.deals.toLocaleString());
    safeText('roi', roi);
    safeText('costPerLead', '楼' + costPerLead);
    safeText('receptionRate', receptionRate.toFixed(2) + '%');
    safeText('lastUpdate', new Date().toLocaleString('zh-CN'));
    var loadingEl2 = document.getElementById('loading');
    if (loadingEl2) loadingEl2.style.display = 'none';
    var statsEl = document.getElementById('stats');
    if (statsEl) statsEl.style.display = 'grid';
    var chartsEl = document.getElementById('charts');
    if (chartsEl) chartsEl.style.display = 'grid';
  }

  function buildChart(chartId) {
    if (Chart.getChart(chartId)) return;
    var ctx = renderContext;
    if (!ctx) return;
    var displayData = ctx.displayData;
    var labels = ctx.labels;
    var total = ctx.total;
    var allDataLocal = ctx.allData;

    if (chartId === 'trendChart') {
      new Chart(document.getElementById('trendChart'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: '鎬诲睍鐜?, data: displayData.map(function (d) {
              return d.totalExp;
            }), borderColor: '#00ffff', tension: 0.4, yAxisID: 'y' },
            { label: '璁垮', data: displayData.map(function (d) {
              return d.visitors;
            }), borderColor: '#ff00ff', tension: 0.4, yAxisID: 'y1' },
            { label: '璇㈢洏', data: displayData.map(function (d) {
              return d.inquiries;
            }), borderColor: '#ffff00', tension: 0.4, yAxisID: 'y1' }
          ]
        },
        options: {
          scales: {
            y: { position: 'left', grid: { color: 'rgba(0,255,255,0.1)' } },
            y1: { position: 'right', grid: { drawOnChartArea: false } }
          },
          plugins: { legend: { labels: { color: '#00ffff' } }, datalabels: { display: false } }
        }
      });
      return;
    }
    if (chartId === 'pieChart') {
      new Chart(document.getElementById('pieChart'), {
        type: 'doughnut',
        data: {
          labels: ['骞垮憡灞曠幇', '鑷劧灞曠幇'],
          datasets: [{ data: [total.adExp, total.naturalExp], backgroundColor: ['#ff00ff', '#00ffff'], borderWidth: 3 }]
        },
        options: {
          plugins: {
            legend: { position: 'bottom', labels: { color: '#00ffff' } },
            datalabels: {
              color: '#fff',
              formatter: function (value, c) {
                var t = c.chart.data.datasets[0].data.reduce(function (a, b) {
                  return a + b;
                }, 0);
                if (!t) return c.chart.data.labels[c.dataIndex] + ' (0%)';
                var p = Math.round((value / t) * 100) + '%';
                return c.chart.data.labels[c.dataIndex] + ' (' + p + ')';
              }
            }
          }
        }
      });
      return;
    }
    if (chartId === 'weeklyChart') {
      var weeks = {};
      displayData.forEach(function (d) {
        var wk = getISOWeekKey(d.date);
        if (!weeks[wk]) weeks[wk] = { inquiries: 0, reception: 0 };
        weeks[wk].inquiries += d.inquiries;
        weeks[wk].reception += d.reception;
      });
      var weekKeys = Object.keys(weeks).sort(); // ISO鍛ㄩ敭瀛楃涓插ぉ鐒舵帓搴?
      new Chart(document.getElementById('weeklyChart'), {
        type: 'line',
        data: {
          labels: weekKeys.map(function (wk) {
            return '绗? + parseInt(wk.split('-W')[1], 10) + '鍛?;
          }),
          datasets: [
            { label: '鍛ㄨ鐩?, data: weekKeys.map(function (wk) {
              return weeks[wk].inquiries;
            }), borderColor: '#ff00ff', tension: 0.4 },
            { label: '鍛ㄦ帴寰?, data: weekKeys.map(function (wk) {
              return weeks[wk].reception;
            }), borderColor: '#00ffff', tension: 0.4 }
          ]
        },
        options: {
          plugins: {
            legend: { labels: { color: '#00ffff' } },
            datalabels: { color: '#fff', anchor: 'end', align: 'top', formatter: Math.round }
          }
        }
      });
      return;
    }
    if (chartId === 'funnelChart') {
      var fCvs = document.getElementById('funnelChart');
      var oldChart = Chart.getChart(fCvs);
      if (oldChart) oldChart.destroy();
      var fCtx = fCvs.getContext('2d');
      var fW = fCvs.offsetWidth || fCvs.parentElement.offsetWidth || 360;
      // 姣忓眰楂樺害瓒冲鏀句袱琛屾枃瀛楋紝鐣欏嚭灞傞棿绠ご绌洪棿
      var rows     = 4;
      var rowH     = 68; // 鍥哄畾姣忓眰68px
      var arrowH   = 18; // 灞傞棿绠ご鍖?
      var fH       = rows * rowH + (rows - 1) * arrowH;
      fCvs.width  = fW;
      fCvs.height = fH;
      fCtx.clearRect(0, 0, fW, fH);
      var fLabels  = ['鎬诲睍鐜?, '璁垮', '璇㈢洏', '鎺ュ緟'];
      var fValues  = [total.totalExp, total.visitors, total.inquiries, total.reception];
      var fColors  = ['#00ffff', '#c026d3', '#f59e0b', '#00ff88'];
      var maxVal   = fValues[0] || 1;
      var maxTopW  = fW * 0.86;
      var minBotW  = fW * 0.14;
      for (var fi = 0; fi < rows; fi++) {
        var y0   = fi * (rowH + arrowH);
        var y1   = y0 + rowH;
        var midY = (y0 + y1) / 2;
        var topW = fi === 0 ? maxTopW : (fValues[fi - 1] / maxVal) * (maxTopW - minBotW) + minBotW;
        var botW = (fValues[fi] / maxVal) * (maxTopW - minBotW) + minBotW;
        var topX = (fW - topW) / 2;
        var botX = (fW - botW) / 2;
        // 姊舰
        fCtx.beginPath();
        fCtx.moveTo(topX, y0);
        fCtx.lineTo(topX + topW, y0);
        fCtx.lineTo(botX + botW, y1);
        fCtx.lineTo(botX, y1);
        fCtx.closePath();
        var grad = fCtx.createLinearGradient(0, y0, 0, y1);
        grad.addColorStop(0, fColors[fi]);
        grad.addColorStop(1, fColors[fi] + 'aa');
        fCtx.fillStyle = grad;
        fCtx.fill();
        // 鏍囩锛堝乏锛屼笂琛岋級
        fCtx.fillStyle = '#0a0a1e';
        fCtx.font = 'bold 13px Microsoft YaHei,Arial';
        fCtx.textAlign = 'left';
        fCtx.fillText(fLabels[fi], topX + 10, midY - 4);
        // 鏁板€硷紙宸︼紝涓嬭锛?
        fCtx.font = '12px Microsoft YaHei,Arial';
        fCtx.fillText(fValues[fi].toLocaleString(), topX + 10, midY + 13);
        // 杞寲鐜囷紙鍙充晶灞呬腑锛?
        if (fi > 0 && fValues[fi - 1] > 0) {
          var cvRate = ((fValues[fi] / fValues[fi - 1]) * 100).toFixed(1) + '%';
          fCtx.fillStyle = '#0a0a1e';
          fCtx.font = 'bold 13px Microsoft YaHei,Arial';
          fCtx.textAlign = 'right';
          fCtx.fillText(cvRate, topX + topW - 10, midY + 4);
        }
        // 灞傞棿绠ご鍖猴紙褰撳墠灞傚簳閮?~ 涓嬩竴灞傞《閮ㄤ箣闂达級
        if (fi < rows - 1) {
          var nextVal = fValues[fi + 1];
          var arrRate = fValues[fi] > 0 ? ((nextVal / fValues[fi]) * 100).toFixed(1) + '%' : '';
          var arrY = y1 + arrowH / 2 + 4;
          fCtx.fillStyle = 'rgba(200,200,220,0.9)';
          fCtx.font = '11px Microsoft YaHei,Arial';
          fCtx.textAlign = 'center';
          fCtx.fillText('鈻?杞寲鐜?' + arrRate, fW / 2, arrY);
        }
      }
      return;
    }
    if (chartId === 'monthlyChart') {
      var months = {};
      allDataLocal.forEach(function (d) {
        var m = format(d.date, 'yyyy-MM');
        if (!months[m]) months[m] = 0;
        months[m] += d.inquiries;
      });
      var monthLabels = Object.keys(months).sort();
      new Chart(document.getElementById('monthlyChart'), {
        type: 'bar',
        data: {
          labels: monthLabels,
          datasets: [{ label: '鏈堣鐩?, data: monthLabels.map(function (m) {
            return months[m];
          }), backgroundColor: '#ff00ff' }]
        },
        options: {
          plugins: {
            legend: { labels: { color: '#00ffff' } },
            datalabels: { color: '#fff', anchor: 'end', align: 'top', formatter: Math.round }
          }
        }
      });
      return;
    }
    if (chartId === 'heatmapChart') {
      var growthData = displayData.map(function (d, i) {
        return i > 0
          ? ((d.inquiries - displayData[i - 1].inquiries) / Math.max(displayData[i - 1].inquiries, 1)) * 100
          : 0;
      });
      new Chart(document.getElementById('heatmapChart'), {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: '澧為暱鐜?',
              data: growthData,
              backgroundColor: growthData.map(function (g) {
                return g > 0 ? 'rgba(0,255,136,0.8)' : 'rgba(255,0,102,0.8)';
              })
            }
          ]
        },
        options: { plugins: { legend: { labels: { color: '#00ffff' } }, datalabels: { display: false } } }
      });
      return;
    }
    if (chartId === 'naturalFlowChart') {
      var naturalData = displayData.map(function (d) {
        return d.naturalExp;
      });
      var predictions = predictFuture(displayData, 'naturalExp', 7);
      var futureLabels = Array.from({ length: 7 }, function (_, i) {
        return '鏈潵' + (i + 1) + '澶?;
      });
      new Chart(document.getElementById('naturalFlowChart'), {
        type: 'line',
        data: {
          labels: labels.concat(futureLabels),
          datasets: [
            { label: '鑷劧娴侀噺', data: naturalData.concat(Array(7).fill(null)), borderColor: '#00ffff', tension: 0.4 },
            {
              label: '棰勬祴',
              data: Array(naturalData.length)
                .fill(null)
                .concat(predictions),
              borderColor: '#ffff00',
              tension: 0.4,
              borderDash: [5, 5]
            }
          ]
        },
        options: { plugins: { legend: { labels: { color: '#00ffff' } }, datalabels: { display: false } } }
      });
      return;
    }
    if (chartId === 'adSpendChart') {
      new Chart(document.getElementById('adSpendChart'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{ label: '骞垮憡鑺辫垂', data: displayData.map(function (d) {
            return d.adSpend;
          }), borderColor: '#ff00ff', tension: 0.4 }]
        },
        options: { plugins: { legend: { labels: { color: '#00ffff' } }, datalabels: { display: false } } }
      });
      return;
    }
    if (chartId === 'leadsChart') {
      new Chart(document.getElementById('leadsChart'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{ label: '绾跨储', data: displayData.map(function (d) {
            return d.leads;
          }), borderColor: '#00ffff', tension: 0.4 }]
        },
        options: { plugins: { legend: { labels: { color: '#00ffff' } }, datalabels: { display: false } } }
      });
      return;
    }
    if (chartId === 'dealsChart') {
      new Chart(document.getElementById('dealsChart'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{ label: '鎴愪氦', data: displayData.map(function (d) {
            return d.deals;
          }), borderColor: '#ffff00', tension: 0.4 }]
        },
        options: { plugins: { legend: { labels: { color: '#00ffff' } }, datalabels: { display: false } } }
      });
      return;
    }
    if (chartId === 'spendVsDealsChart') {
      new Chart(document.getElementById('spendVsDealsChart'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: '骞垮憡鑺辫垂', data: displayData.map(function (d) {
              return d.adSpend;
            }), borderColor: '#ff00ff', tension: 0.4, yAxisID: 'y' },
            { label: '鎴愪氦閲戦', data: displayData.map(function (d) {
              return d.deals;
            }), borderColor: '#00ffff', tension: 0.4, yAxisID: 'y1' }
          ]
        },
        options: {
          scales: {
            y: { position: 'left', grid: { color: 'rgba(0,255,255,0.1)' } },
            y1: { position: 'right', grid: { drawOnChartArea: false } }
          },
          plugins: { legend: { labels: { color: '#00ffff' } }, datalabels: { display: false } }
        }
      });
      return;
    }
    if (chartId === 'receptionTrendChart') {
      new Chart(document.getElementById('receptionTrendChart'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: '鎺ュ緟', data: displayData.map(function (d) {
              return d.reception;
            }), borderColor: '#00ff88', tension: 0.4 },
            { label: '璇㈢洏', data: displayData.map(function (d) {
              return d.inquiries;
            }), borderColor: '#ffff00', tension: 0.4 }
          ]
        },
        options: { plugins: { legend: { labels: { color: '#00ffff' } }, datalabels: { display: false } } }
      });
    }
  }

  function setupLazyCharts() {
    disconnectChartObserver();
    chartObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var id = en.target.getAttribute('data-chart');
          if (id) {
            buildChart(id);
            chartObserver.unobserve(en.target);
          }
        });
      },
      { root: null, rootMargin: '180px 0px', threshold: 0.01 }
    );
    document.querySelectorAll('.chart-card[data-chart]').forEach(function (card) {
      chartObserver.observe(card);
    });
    document.querySelectorAll('.chart-card[data-chart]').forEach(function (card) {
      var r = card.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight + 200) {
        var id = card.getAttribute('data-chart');
        if (id) buildChart(id);
      }
    });
  }

  function renderAll() {
    destroyAllCharts();
    disconnectChartObserver();

    var displayData = allData;
    if (currentMonth) {
      displayData = allData.filter(function (d) {
        return format(d.date, 'yyyy-MM') === currentMonth;
      });
    }

    var total = reduceTotals(displayData);
    var labels = displayData.map(function (d) {
      return format(d.date, 'MM-dd');
    });
    renderContext = { displayData: displayData, labels: labels, total: total, allData: allData };

    updateKpiDom(displayData, total);
    setupLazyCharts();
  }

  function exportChartPng(canvasId) {
    var chart = Chart.getChart(canvasId);
    if (!chart) {
      alert('鍥捐〃灏氭湭娓叉煋锛岃鍏堟粴鍔ㄥ埌璇ュ尯鍩熴€?);
      return;
    }
    var a = document.createElement('a');
    a.download = canvasId + '_' + format(new Date(), 'yyyy-MM-dd') + '.png';
    a.href = chart.toBase64Image();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function buildReportStyles() {
    return [
      'body{font-family:"Microsoft YaHei",Arial,sans-serif;color:#1a1a2e;background:#fff;margin:0;padding:20px;}',
      '.rpt-wrap{max-width:960px;margin:0 auto;}',
      '.rpt-title{text-align:center;font-size:22px;font-weight:bold;color:#1a1a2e;margin-bottom:4px;}',
      '.rpt-subtitle{text-align:center;font-size:13px;color:#555;margin-bottom:18px;}',
      '.rpt-meta{display:flex;justify-content:space-between;font-size:12px;color:#777;margin-bottom:10px;}',
      'table{width:100%;border-collapse:collapse;font-size:13px;}',
      'th{background:#1a1a2e;color:#fff;padding:9px 8px;text-align:center;white-space:nowrap;border:1px solid #334;}',
      'td{padding:8px;text-align:center;border:1px solid #dde;white-space:nowrap;}',
      'tr:nth-child(even) td{background:#f4f8ff;}',
      'tr:hover td{background:#e8f0ff;}',
      '.total-row td{background:#e6f0ff!important;font-weight:bold;color:#1a1a2e;}',
      '.pos{color:#0a7c3e;font-weight:bold;}',
      '.neg{color:#c0392b;font-weight:bold;}',
      '.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0;}',
      '.kpi-box{border:1px solid #dde;border-radius:8px;padding:14px 10px;text-align:center;}',
      '.kpi-val{font-size:22px;font-weight:bold;color:#1a1a2e;}',
      '.kpi-lbl{font-size:11px;color:#777;margin-top:4px;}'
    ].join('');
  }

  function pct(a, b) {
    if (!b) return '鈥?;
    return ((a / b) * 100).toFixed(2) + '%';
  }

  function momStr(cur, prev) {
    if (!prev) return cur > 0 ? '<span class="pos">+鈭?</span>' : '鈥?;
    var r = ((cur / prev - 1) * 100);
    var rs = r.toFixed(1);
    return parseFloat(rs) >= 0
      ? '<span class="pos">鈻? + rs + '%</span>'
      : '<span class="neg">鈻? + Math.abs(r).toFixed(1) + '%</span>';
  }

  // 鍦ㄧ灞廲anvas涓婃覆鏌揅hart.js鍥捐〃锛岃繑鍥瀊ase64鍥剧墖瀛楃涓?
  function renderChartToBase64(config, w, h) {
    return new Promise(function (resolve) {
      var cvs = document.createElement('canvas');
      cvs.width = w || 1100;
      cvs.height = h || 300;
      cvs.style.cssText = 'position:absolute;left:-30000px;top:0;';
      document.body.appendChild(cvs);
      // 鍏抽棴鍔ㄧ敾淇濊瘉绔嬪嵆鍙埅鍥?
      config.options = config.options || {};
      config.options.animation = { duration: 0 };
      config.options.responsive = false;
      config.options.maintainAspectRatio = false;
      var ch = new Chart(cvs, config);
      setTimeout(function () {
        var b64 = cvs.toDataURL('image/png');
        ch.destroy();
        document.body.removeChild(cvs);
        resolve(b64);
      }, 120);
    });
  }

  // 鍏敤鎶樼嚎鍥鹃鑹叉柟妗?
  var CHART_PALETTE = {
    blue:   { line: '#2563eb', fill: 'rgba(37,99,235,0.08)' },
    pink:   { line: '#db2777', fill: 'rgba(219,39,119,0.08)' },
    green:  { line: '#059669', fill: 'rgba(5,150,105,0.08)' },
    orange: { line: '#d97706', fill: 'rgba(217,119,6,0.08)' },
    purple: { line: '#7c3aed', fill: 'rgba(124,58,237,0.08)' }
  };

  function chartSection(title, imgSrc) {
    return '<div style="margin:24px 0 8px;font-size:15px;font-weight:bold;color:#1a1a2e;border-bottom:2px solid #1a1a2e;padding-bottom:4px;">鈻?' + title + '</div>' +
      '<img src="' + imgSrc + '" style="width:100%;border:1px solid #e0e0e0;border-radius:6px;display:block;" />';
  }

  async function downloadWeeklySummary() {
    var displayData = currentMonth
      ? allData.filter(function (d) { return format(d.date, 'yyyy-MM') === currentMonth; })
      : allData;

    var weeks = {};
    displayData.forEach(function (d) {
      var wk = getISOWeekKey(d.date);
      if (!weeks[wk]) {
        weeks[wk] = {
          inquiries: 0, reception: 0, visitors: 0, adSpend: 0,
          leads: 0, deals: 0, totalExp: 0, adExp: 0,
          minDate: d.date, maxDate: d.date
        };
      }
      var w = weeks[wk];
      w.inquiries += d.inquiries;
      w.reception += d.reception;
      w.visitors += d.visitors;
      w.adSpend += d.adSpend;
      w.leads += d.leads;
      w.deals += d.deals;
      w.totalExp += d.totalExp;
      w.adExp += d.adExp;
      if (d.date < w.minDate) w.minDate = d.date;
      if (d.date > w.maxDate) w.maxDate = d.date;
    });

    var weekKeys = Object.keys(weeks).sort(); // ISO鍛ㄩ敭瀛楃涓插ぉ鐒舵寜鏃堕棿鎺掑簭
    var totals = { inquiries: 0, reception: 0, visitors: 0, adSpend: 0, leads: 0, deals: 0, totalExp: 0 };
    weekKeys.forEach(function (wk) {
      var w = weeks[wk];
      totals.inquiries += w.inquiries;
      totals.reception += w.reception;
      totals.visitors += w.visitors;
      totals.adSpend += w.adSpend;
      totals.leads += w.leads;
      totals.deals += w.deals;
      totals.totalExp += w.totalExp;
    });

    var styles = buildReportStyles();
    var cols = ['鍛ㄥ彿', '鏃ユ湡鑼冨洿', '灞曠幇閲?, '璁垮鏁?, '璇㈢洏鏁?, '鎺ュ緟鏁?, '璇㈢洏杞寲鐜?, '鎺ュ緟杞寲鐜?,
                '骞垮憡鑺辫垂', '绾跨储鏁?, '鍗曠嚎绱㈡垚鏈?, '鎴愪氦閲戦', 'ROI', '鍛ㄨ鐩樼幆姣?];
    var thRow = cols.map(function (c) { return '<th>' + c + '</th>'; }).join('');

    var rows = '';
    weekKeys.forEach(function (wk, i) {
      var w = weeks[wk];
      var prev = i > 0 ? weeks[weekKeys[i - 1]] : null;
      var dateRng = format(w.minDate, 'MM-dd') + '~' + format(w.maxDate, 'MM-dd');
      var roi = w.adSpend > 0 ? ((w.deals / w.adSpend) * 100).toFixed(1) + '%' : '鈥?;
      var cpl = w.leads > 0 ? '楼' + (w.adSpend / w.leads).toFixed(2) : '鈥?;
      var weekNo = parseInt(wk.split('-W')[1], 10); // 2026骞寸湡瀹炲懆鍙?
      rows += '<tr>' +
        '<td><b>绗? + weekNo + '鍛?/b></td>' +
        '<td>' + dateRng + '</td>' +
        '<td>' + w.totalExp.toLocaleString() + '</td>' +
        '<td>' + w.visitors.toLocaleString() + '</td>' +
        '<td><b>' + w.inquiries + '</b></td>' +
        '<td>' + w.reception + '</td>' +
        '<td>' + pct(w.inquiries, w.visitors) + '</td>' +
        '<td>' + pct(w.reception, w.inquiries) + '</td>' +
        '<td>楼' + w.adSpend.toFixed(2) + '</td>' +
        '<td>' + w.leads + '</td>' +
        '<td>' + cpl + '</td>' +
        '<td>楼' + w.deals.toLocaleString() + '</td>' +
        '<td>' + roi + '</td>' +
        '<td>' + (prev ? momStr(w.inquiries, prev.inquiries) : '鈥?) + '</td>' +
        '</tr>';
    });

    var totalRoi = totals.adSpend > 0 ? ((totals.deals / totals.adSpend) * 100).toFixed(1) + '%' : '鈥?;
    var totalCpl = totals.leads > 0 ? '楼' + (totals.adSpend / totals.leads).toFixed(2) : '鈥?;
    rows += '<tr class="total-row">' +
      '<td colspan="2"><b>鍚?璁?/b></td>' +
      '<td>' + totals.totalExp.toLocaleString() + '</td>' +
      '<td>' + totals.visitors.toLocaleString() + '</td>' +
      '<td><b>' + totals.inquiries + '</b></td>' +
      '<td>' + totals.reception + '</td>' +
      '<td>' + pct(totals.inquiries, totals.visitors) + '</td>' +
      '<td>' + pct(totals.reception, totals.inquiries) + '</td>' +
      '<td>楼' + totals.adSpend.toFixed(2) + '</td>' +
      '<td>' + totals.leads + '</td>' +
      '<td>' + totalCpl + '</td>' +
      '<td>楼' + totals.deals.toLocaleString() + '</td>' +
      '<td>' + totalRoi + '</td>' +
      '<td>鈥?/td>' +
      '</tr>';

    var rangeLabel = currentMonth ? currentMonth + ' 鏈堬紙绗? + weekKeys.map(function(wk){ return parseInt(wk.split('-W')[1],10); }).join('/') + '鍛級' : '鍏ㄩ儴鏃堕棿';
    var totalConvRate = totals.visitors > 0 ? ((totals.inquiries / totals.visitors) * 100).toFixed(2) + '%' : '鈥?;
    var totalRecRate  = totals.inquiries > 0 ? ((totals.reception / totals.inquiries) * 100).toFixed(2) + '%' : '鈥?;
    if (!assertPdfLibs()) return;

    // 鈹€鈹€ 鐢熸垚鎶樼嚎鍥?锛氬懆璇㈢洏 + 鍛ㄦ帴寰?+ 鍛ㄨ瀹?鈹€鈹€
    var wkLabels = weekKeys.map(function (wk) { return '绗? + parseInt(wk.split('-W')[1], 10) + '鍛?; });
    var chart1Img = await renderChartToBase64({
      type: 'line',
      data: {
        labels: wkLabels,
        datasets: [
          { label: '璇㈢洏鏁?, data: weekKeys.map(function(w){ return weeks[w].inquiries; }),
            borderColor: CHART_PALETTE.blue.line, backgroundColor: CHART_PALETTE.blue.fill,
            borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: CHART_PALETTE.blue.line, fill: true, tension: 0.35, yAxisID: 'y' },
          { label: '鎺ュ緟鏁?, data: weekKeys.map(function(w){ return weeks[w].reception; }),
            borderColor: CHART_PALETTE.green.line, backgroundColor: CHART_PALETTE.green.fill,
            borderWidth: 2, pointRadius: 4, pointBackgroundColor: CHART_PALETTE.green.line, fill: false, tension: 0.35, yAxisID: 'y' },
          { label: '璁垮鏁?, data: weekKeys.map(function(w){ return weeks[w].visitors; }),
            borderColor: CHART_PALETTE.purple.line, backgroundColor: CHART_PALETTE.purple.fill,
            borderWidth: 2, pointRadius: 4, pointBackgroundColor: CHART_PALETTE.purple.line, fill: false, tension: 0.35, yAxisID: 'y1',
            borderDash: [5, 3] }
        ]
      },
      options: {
        plugins: {
          legend: { labels: { color: '#1a1a2e', font: { size: 13 } } },
          datalabels: { color: '#1a1a2e', anchor: 'end', align: 'top', font: { size: 11 },
            formatter: function(v, ctx) { return ctx.dataset.yAxisID === 'y1' ? '' : v; } }
        },
        scales: {
          y:  { position: 'left',  title: { display: true, text: '璇㈢洏 / 鎺ュ緟', color: '#555' }, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#555' } },
          y1: { position: 'right', title: { display: true, text: '璁垮鏁?, color: '#555' }, grid: { drawOnChartArea: false }, ticks: { color: '#555' } }
        }
      }
    }, 1120, 310);

    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + styles + '</style></head><body>' +
      '<div class="rpt-wrap">' +
      '<div class="rpt-title">馃搳 鍛ㄥ害姹囨€绘姤鍛?/div>' +
      '<div class="rpt-subtitle">姹夐缚搴楅摵 路 闃块噷宸村反鏁版嵁鎴樻儏瀹?/div>' +
      '<div class="rpt-meta"><span>缁熻鑼冨洿锛? + rangeLabel + '</span><span>鐢熸垚鏃堕棿锛? + new Date().toLocaleString('zh-CN') + '</span></div>' +
      '<div class="kpi-grid">' +
      '<div class="kpi-box"><div class="kpi-val">' + totals.totalExp.toLocaleString() + '</div><div class="kpi-lbl">鎬诲睍鐜伴噺</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totals.visitors.toLocaleString() + '</div><div class="kpi-lbl">鎬昏瀹㈡暟</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totals.inquiries + '</div><div class="kpi-lbl">鎬昏鐩樻暟</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totals.reception + '</div><div class="kpi-lbl">鎬绘帴寰呮暟</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totalConvRate + '</div><div class="kpi-lbl">璇㈢洏杞寲鐜?/div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totalRecRate + '</div><div class="kpi-lbl">鎺ュ緟杞寲鐜?/div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totals.leads + '</div><div class="kpi-lbl">鎬荤嚎绱㈡暟</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totalCpl + '</div><div class="kpi-lbl">鍗曠嚎绱㈡垚鏈?/div></div>' +
      '<div class="kpi-box"><div class="kpi-val">楼' + totals.adSpend.toFixed(0) + '</div><div class="kpi-lbl">鎬诲箍鍛婅姳璐?/div></div>' +
      '<div class="kpi-box"><div class="kpi-val">楼' + totals.deals.toLocaleString() + '</div><div class="kpi-lbl">鎬绘垚浜ら噾棰?/div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totalRoi + '</div><div class="kpi-lbl">缁煎悎ROI</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + weekKeys.length + ' 鍛?/div><div class="kpi-lbl">缁熻鍛ㄦ暟</div></div>' +
      '</div>' +
      chartSection('鍛ㄨ鐩?路 鎺ュ緟 路 璁垮瓒嬪娍', chart1Img) +
      '<div style="margin:20px 0 6px;font-size:15px;font-weight:bold;color:#1a1a2e;border-bottom:2px solid #1a1a2e;padding-bottom:4px;">鈻?鍛ㄥ害鏄庣粏鏁版嵁</div>' +
      '<table><thead><tr>' + thRow + '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div></body></html>';

    var tempContainer = document.createElement('div');
    tempContainer.innerHTML = html;
    tempContainer.style.cssText = 'position:absolute;left:-10000px;background:white;padding:20px;color:#000;width:1200px;';
    document.body.appendChild(tempContainer);
    try {
      var canvas = await html2canvas(tempContainer, { scale: 1.5, backgroundColor: '#ffffff', logging: false, useCORS: true });
      // 鍗曢〉鑷畾涔夐珮搴︼紝褰诲簳涓嶅垎椤典笉鎴柇
      var pdfW = 297;
      var pdfH = Math.ceil(canvas.height * pdfW / canvas.width);
      var pdf = new jspdf.jsPDF({ orientation: 'l', unit: 'mm', format: [pdfW, pdfH] });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfW, pdfH);
      pdf.save('鍛ㄥ害姹囨€籣' + (currentMonth || '鍏ㄦ湡') + '.pdf');
      alert('鉁?鍛ㄥ害姹囨€诲凡涓嬭浇锛堝畬鏁村崟椤碉紝鏃犳埅鏂級');
    } catch (err) {
      alert('瀵煎嚭澶辫触锛? + (err && err.message ? err.message : String(err)));
    } finally {
      document.body.removeChild(tempContainer);
    }
  }

  async function downloadMonthlySummary() {
    // 鏀堕泦鎵€鏈夊彲鐢ㄦ湀浠戒緵鐢ㄦ埛澶氶€?
    var allMonths = [];
    allData.forEach(function(d) {
      var m = format(d.date, 'yyyy-MM');
      if (allMonths.indexOf(m) === -1) allMonths.push(m);
    });
    allMonths.sort();
    var selectedMonths = allMonths;
    if (allMonths.length > 0) {
      var picked = await showPickerDialog('馃搱 閫夋嫨瑕佷笅杞界殑鏈堜唤', allMonths);
      if (!picked) return; // 鐢ㄦ埛鍙栨秷
      selectedMonths = picked;
    }

    var months = {};
    allData.filter(function(d) {
      return selectedMonths.indexOf(format(d.date, 'yyyy-MM')) !== -1;
    }).forEach(function (d) {
      var m = format(d.date, 'yyyy-MM');
      if (!months[m]) months[m] = { inquiries: 0, reception: 0, visitors: 0, adSpend: 0, leads: 0, deals: 0, totalExp: 0, adExp: 0 };
      months[m].inquiries += d.inquiries;
      months[m].reception += d.reception;
      months[m].visitors += d.visitors;
      months[m].adSpend += d.adSpend;
      months[m].leads += d.leads;
      months[m].deals += d.deals;
      months[m].totalExp += d.totalExp;
      months[m].adExp += d.adExp;
    });

    var monthKeys = Object.keys(months).sort();
    var totals = { inquiries: 0, reception: 0, visitors: 0, adSpend: 0, leads: 0, deals: 0, totalExp: 0 };
    monthKeys.forEach(function (mk) {
      var m = months[mk];
      totals.inquiries += m.inquiries;
      totals.reception += m.reception;
      totals.visitors += m.visitors;
      totals.adSpend += m.adSpend;
      totals.leads += m.leads;
      totals.deals += m.deals;
      totals.totalExp += m.totalExp;
    });

    var styles = buildReportStyles();
    var cols = ['鏈堜唤', '灞曠幇閲?, '璁垮鏁?, '璇㈢洏鏁?, '鎺ュ緟鏁?, '璇㈢洏杞寲鐜?, '鎺ュ緟杞寲鐜?,
                '骞垮憡鑺辫垂', '骞垮憡鍗犳瘮', '绾跨储鏁?, '鍗曠嚎绱㈡垚鏈?, '鎴愪氦閲戦', 'ROI', '鏈堣鐩樼幆姣?];
    var thRow = cols.map(function (c) { return '<th>' + c + '</th>'; }).join('');

    var rows = '';
    monthKeys.forEach(function (mk, i) {
      var m = months[mk];
      var prev = i > 0 ? months[monthKeys[i - 1]] : null;
      var roi = m.adSpend > 0 ? ((m.deals / m.adSpend) * 100).toFixed(1) + '%' : '鈥?;
      var cpl = m.leads > 0 ? '楼' + (m.adSpend / m.leads).toFixed(2) : '鈥?;
      var adPct = m.totalExp > 0 ? ((m.adExp / m.totalExp) * 100).toFixed(1) + '%' : '鈥?;
      rows += '<tr>' +
        '<td><b>' + mk + '</b></td>' +
        '<td>' + m.totalExp.toLocaleString() + '</td>' +
        '<td>' + m.visitors.toLocaleString() + '</td>' +
        '<td><b>' + m.inquiries + '</b></td>' +
        '<td>' + m.reception + '</td>' +
        '<td>' + pct(m.inquiries, m.visitors) + '</td>' +
        '<td>' + pct(m.reception, m.inquiries) + '</td>' +
        '<td>楼' + m.adSpend.toFixed(2) + '</td>' +
        '<td>' + adPct + '</td>' +
        '<td>' + m.leads + '</td>' +
        '<td>' + cpl + '</td>' +
        '<td>楼' + m.deals.toLocaleString() + '</td>' +
        '<td>' + roi + '</td>' +
        '<td>' + (prev ? momStr(m.inquiries, prev.inquiries) : '鈥?) + '</td>' +
        '</tr>';
    });

    var totalRoi = totals.adSpend > 0 ? ((totals.deals / totals.adSpend) * 100).toFixed(1) + '%' : '鈥?;
    var totalCpl = totals.leads > 0 ? '楼' + (totals.adSpend / totals.leads).toFixed(2) : '鈥?;
    rows += '<tr class="total-row">' +
      '<td><b>鍚?璁?/b></td>' +
      '<td>' + totals.totalExp.toLocaleString() + '</td>' +
      '<td>' + totals.visitors.toLocaleString() + '</td>' +
      '<td><b>' + totals.inquiries + '</b></td>' +
      '<td>' + totals.reception + '</td>' +
      '<td>' + pct(totals.inquiries, totals.visitors) + '</td>' +
      '<td>' + pct(totals.reception, totals.inquiries) + '</td>' +
      '<td>楼' + totals.adSpend.toFixed(2) + '</td>' +
      '<td>鈥?/td>' +
      '<td>' + totals.leads + '</td>' +
      '<td>' + totalCpl + '</td>' +
      '<td>楼' + totals.deals.toLocaleString() + '</td>' +
      '<td>' + totalRoi + '</td>' +
      '<td>鈥?/td>' +
      '</tr>';

    if (!assertPdfLibs()) return;

    // 鈹€鈹€ 鐢熸垚鎶樼嚎鍥?锛氭湀搴﹁鐩?+ 鎺ュ緟 + 璁垮 鈹€鈹€
    var chart3Img = await renderChartToBase64({
      type: 'line',
      data: {
        labels: monthKeys,
        datasets: [
          { label: '璇㈢洏鏁?, data: monthKeys.map(function(m){ return months[m].inquiries; }),
            borderColor: CHART_PALETTE.blue.line, backgroundColor: CHART_PALETTE.blue.fill,
            borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: CHART_PALETTE.blue.line, fill: true, tension: 0.4, yAxisID: 'y' },
          { label: '鎺ュ緟鏁?, data: monthKeys.map(function(m){ return months[m].reception; }),
            borderColor: CHART_PALETTE.green.line, backgroundColor: CHART_PALETTE.green.fill,
            borderWidth: 2, pointRadius: 4, pointBackgroundColor: CHART_PALETTE.green.line, fill: false, tension: 0.4, yAxisID: 'y' },
          { label: '璁垮鏁?, data: monthKeys.map(function(m){ return months[m].visitors; }),
            borderColor: CHART_PALETTE.purple.line, borderWidth: 2, pointRadius: 4,
            pointBackgroundColor: CHART_PALETTE.purple.line, fill: false, tension: 0.4, yAxisID: 'y1', borderDash: [5, 3] }
        ]
      },
      options: {
        plugins: {
          legend: { labels: { color: '#1a1a2e', font: { size: 13 } } },
          datalabels: { color: '#1a1a2e', anchor: 'end', align: 'top', font: { size: 11 },
            formatter: function(v, ctx) { return ctx.dataset.yAxisID === 'y1' ? '' : v; } }
        },
        scales: {
          y:  { position: 'left',  title: { display: true, text: '璇㈢洏 / 鎺ュ緟', color: '#555' }, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#555' } },
          y1: { position: 'right', title: { display: true, text: '璁垮鏁?, color: '#555' }, grid: { drawOnChartArea: false }, ticks: { color: '#555' } }
        }
      }
    }, 1200, 320);

    // 鈹€鈹€ 鐢熸垚鎶樼嚎鍥?锛氬箍鍛婅姳璐?鏌? + ROI(绾? 鈹€鈹€
    var roiData = monthKeys.map(function(m) {
      var mo = months[m];
      return mo.adSpend > 0 ? parseFloat(((mo.deals / mo.adSpend) * 100).toFixed(1)) : 0;
    });
    var chart4Img = await renderChartToBase64({
      type: 'bar',
      data: {
        labels: monthKeys,
        datasets: [
          { type: 'bar', label: '骞垮憡鑺辫垂(楼)',
            data: monthKeys.map(function(m){ return months[m].adSpend; }),
            backgroundColor: 'rgba(217,119,6,0.65)', borderColor: CHART_PALETTE.orange.line, borderWidth: 1.5, yAxisID: 'y' },
          { type: 'line', label: 'ROI(%)',
            data: roiData,
            borderColor: CHART_PALETTE.pink.line, backgroundColor: 'transparent',
            borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: CHART_PALETTE.pink.line,
            tension: 0.4, yAxisID: 'y1' }
        ]
      },
      options: {
        plugins: {
          legend: { labels: { color: '#1a1a2e', font: { size: 13 } } },
          datalabels: { display: false }
        },
        scales: {
          y:  { position: 'left',  title: { display: true, text: '骞垮憡鑺辫垂(楼)', color: '#555' }, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#555' } },
          y1: { position: 'right', title: { display: true, text: 'ROI(%)', color: '#555' }, grid: { drawOnChartArea: false }, ticks: { color: '#555' } }
        }
      }
    }, 1200, 320);

    var mConvRate = totals.visitors > 0 ? ((totals.inquiries / totals.visitors) * 100).toFixed(2) + '%' : '鈥?;
    var mRecRate  = totals.inquiries > 0 ? ((totals.reception / totals.inquiries) * 100).toFixed(2) + '%' : '鈥?;

    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + styles + '</style></head><body>' +
      '<div class="rpt-wrap">' +
      '<div class="rpt-title">馃搱 鏈堝害姹囨€绘姤鍛?/div>' +
      '<div class="rpt-subtitle">姹夐缚搴楅摵 路 闃块噷宸村反鏁版嵁鎴樻儏瀹?/div>' +
      '<div class="rpt-meta"><span>缁熻鏈堜唤锛? + (monthKeys[0] || '') + ' 鑷?' + (monthKeys[monthKeys.length-1] || '') + '锛堝叡 ' + monthKeys.length + ' 涓湀锛?/span><span>鐢熸垚鏃堕棿锛? + new Date().toLocaleString('zh-CN') + '</span></div>' +
      chartSection('鏈堝害璇㈢洏 路 鎺ュ緟 路 璁垮瓒嬪娍', chart3Img) +
      chartSection('鏈堝害骞垮憡鑺辫垂锛堟煴锛? ROI瓒嬪娍锛堟姌绾匡級', chart4Img) +
      '<div style="margin:20px 0 6px;font-size:15px;font-weight:bold;color:#1a1a2e;border-bottom:2px solid #1a1a2e;padding-bottom:4px;">鈻?鏈堝害鏄庣粏鏁版嵁</div>' +
      '<table><thead><tr>' + thRow + '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div></body></html>';

    var tempContainer = document.createElement('div');
    tempContainer.innerHTML = html;
    tempContainer.style.cssText = 'position:absolute;left:-10000px;background:white;padding:20px;color:#000;width:1300px;';
    document.body.appendChild(tempContainer);
    try {
      var canvas = await html2canvas(tempContainer, { scale: 1.5, backgroundColor: '#ffffff', logging: false, useCORS: true });
      var pdfW = 297;
      var pdfH = Math.ceil(canvas.height * pdfW / canvas.width);
      var pdf = new jspdf.jsPDF({ orientation: 'l', unit: 'mm', format: [pdfW, pdfH] });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfW, pdfH);
      pdf.save('鏈堝害姹囨€籣' + selectedMonths.join('_') + '.pdf');
      alert('鉁?鏈堝害姹囨€诲凡涓嬭浇锛? + selectedMonths.length + '涓湀锛屽畬鏁村崟椤垫棤鎴柇锛?);
    } catch (err) {
      alert('瀵煎嚭澶辫触锛? + (err && err.message ? err.message : String(err)));
    } finally {
      document.body.removeChild(tempContainer);
    }
  }

  async function downloadAnnualSummary() {
    // 鏀堕泦鎵€鏈夊勾浠戒緵鐢ㄦ埛閫夋嫨
    var availableYears = [];
    allData.forEach(function (d) {
      var y = String(d.date.getFullYear());
      if (availableYears.indexOf(y) === -1) availableYears.push(y);
    });
    availableYears.sort();
    var selectedYears = availableYears; // 榛樿鍏ㄩ€?
    if (availableYears.length > 0) {
      var picked = await showPickerDialog('馃搮 閫夋嫨瑕佷笅杞界殑骞村害', availableYears);
      if (!picked) return; // 鐢ㄦ埛鍙栨秷
      selectedYears = picked;
    }

    // 鎸夊勾鍒嗙粍
    var years = {};
    allData.filter(function(d){
      return selectedYears.indexOf(String(d.date.getFullYear())) !== -1;
    }).forEach(function (d) {
      var y = d.date.getFullYear();
      if (!years[y]) years[y] = { inquiries: 0, reception: 0, visitors: 0, adSpend: 0, leads: 0, deals: 0, totalExp: 0, adExp: 0, dealCount: 0 };
      var yr = years[y];
      yr.inquiries += d.inquiries;
      yr.reception += d.reception;
      yr.visitors += d.visitors;
      yr.adSpend += d.adSpend;
      yr.leads += d.leads;
      yr.deals += d.deals;
      yr.totalExp += d.totalExp;
      yr.adExp += d.adExp;
      yr.dealCount += (d.dealCount || 0);
    });

    var yearKeys = Object.keys(years).sort();

    // 鍚屾椂鎸夋湀姹囨€伙紙鐢ㄤ簬鏈堟槑缁嗚〃锛?
    var monthMap = {};
    allData.filter(function(d){
      return selectedYears.indexOf(String(d.date.getFullYear())) !== -1;
    }).forEach(function (d) {
      var mk = format(d.date, 'yyyy-MM');
      if (!monthMap[mk]) monthMap[mk] = { inquiries: 0, reception: 0, visitors: 0, adSpend: 0, leads: 0, deals: 0, totalExp: 0 };
      monthMap[mk].inquiries += d.inquiries;
      monthMap[mk].reception += d.reception;
      monthMap[mk].visitors += d.visitors;
      monthMap[mk].adSpend += d.adSpend;
      monthMap[mk].leads += d.leads;
      monthMap[mk].deals += d.deals;
      monthMap[mk].totalExp += d.totalExp;
    });

    var styles = buildReportStyles();

    // 骞村害鏍稿績鎸囨爣琛?
    var yearRows = '';
    yearKeys.forEach(function (yk, i) {
      var y = years[yk];
      var prev = i > 0 ? years[yearKeys[i - 1]] : null;
      var roi = y.adSpend > 0 ? ((y.deals / y.adSpend) * 100).toFixed(1) + '%' : '鈥?;
      var cpl = y.leads > 0 ? '楼' + (y.adSpend / y.leads).toFixed(2) : '鈥?;
      yearRows += '<tr>' +
        '<td><b>' + yk + '骞?/b></td>' +
        '<td>' + y.totalExp.toLocaleString() + '</td>' +
        '<td>' + y.visitors.toLocaleString() + '</td>' +
        '<td><b>' + y.inquiries + '</b></td>' +
        '<td>' + y.reception + '</td>' +
        '<td>' + pct(y.inquiries, y.visitors) + '</td>' +
        '<td>' + pct(y.reception, y.inquiries) + '</td>' +
        '<td>楼' + y.adSpend.toFixed(2) + '</td>' +
        '<td>' + y.leads + '</td>' +
        '<td>' + cpl + '</td>' +
        '<td>楼' + y.deals.toLocaleString() + '</td>' +
        '<td>' + (y.dealCount > 0 ? y.dealCount : '鈥?) + '</td>' +
        '<td>' + roi + '</td>' +
        '<td>' + (prev ? momStr(y.inquiries, prev.inquiries) : '鈥?) + '</td>' +
        '</tr>';
    });

    // 鏈堟槑缁嗚〃
    var monthKeys2 = Object.keys(monthMap).sort();
    var monthRows = '';
    monthKeys2.forEach(function (mk, i) {
      var m = monthMap[mk];
      var prev = i > 0 ? monthMap[monthKeys2[i - 1]] : null;
      var roi = m.adSpend > 0 ? ((m.deals / m.adSpend) * 100).toFixed(1) + '%' : '鈥?;
      monthRows += '<tr>' +
        '<td><b>' + mk + '</b></td>' +
        '<td>' + m.visitors.toLocaleString() + '</td>' +
        '<td><b>' + m.inquiries + '</b></td>' +
        '<td>' + m.reception + '</td>' +
        '<td>' + pct(m.inquiries, m.visitors) + '</td>' +
        '<td>楼' + m.adSpend.toFixed(2) + '</td>' +
        '<td>' + m.leads + '</td>' +
        '<td>楼' + m.deals.toLocaleString() + '</td>' +
        '<td>' + roi + '</td>' +
        '<td>' + (prev ? momStr(m.inquiries, prev.inquiries) : '鈥?) + '</td>' +
        '</tr>';
    });

    var totalAll = allData.filter(function(d){
      return selectedYears.indexOf(String(d.date.getFullYear())) !== -1;
    }).reduce(function (a, d) {
      return { inquiries: a.inquiries + d.inquiries, adSpend: a.adSpend + d.adSpend, deals: a.deals + d.deals, visitors: a.visitors + d.visitors, leads: a.leads + d.leads };
    }, { inquiries: 0, adSpend: 0, deals: 0, visitors: 0, leads: 0 });
    var totalRoi = totalAll.adSpend > 0 ? ((totalAll.deals / totalAll.adSpend) * 100).toFixed(1) + '%' : '鈥?;

    if (!assertPdfLibs()) return;

    // 鈹€鈹€ 鎶樼嚎鍥?锛氭湀搴﹁鐩?+ 鎴愪氦閲戦鍙岃酱瓒嬪娍 鈹€鈹€
    var chart5Img = await renderChartToBase64({
      type: 'line',
      data: {
        labels: monthKeys2,
        datasets: [
          { label: '鏈堣鐩?, data: monthKeys2.map(function(m){ return monthMap[m].inquiries; }),
            borderColor: CHART_PALETTE.blue.line, backgroundColor: CHART_PALETTE.blue.fill,
            borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: CHART_PALETTE.blue.line,
            fill: true, tension: 0.4, yAxisID: 'y' },
          { label: '鎴愪氦閲戦(楼)', data: monthKeys2.map(function(m){ return monthMap[m].deals; }),
            borderColor: CHART_PALETTE.pink.line, backgroundColor: 'transparent',
            borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: CHART_PALETTE.pink.line,
            fill: false, tension: 0.4, yAxisID: 'y1' }
        ]
      },
      options: {
        plugins: {
          legend: { labels: { color: '#1a1a2e', font: { size: 13 } } },
          datalabels: { color: '#1a1a2e', anchor: 'end', align: 'top', font: { size: 10 },
            formatter: function(v, ctx) { return ctx.dataset.yAxisID === 'y1' ? '' : v; } }
        },
        scales: {
          y:  { position: 'left',  title: { display: true, text: '鏈堣鐩樻暟', color: '#555' }, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#555' } },
          y1: { position: 'right', title: { display: true, text: '鎴愪氦閲戦(楼)', color: '#555' }, grid: { drawOnChartArea: false }, ticks: { color: '#555' } }
        }
      }
    }, 1200, 300);

    // 鈹€鈹€ 鎶樼嚎鍥?锛氭湀搴﹀箍鍛婅姳璐?+ 璁垮 + 绾跨储 鈹€鈹€
    var chart6Img = await renderChartToBase64({
      type: 'line',
      data: {
        labels: monthKeys2,
        datasets: [
          { label: '骞垮憡鑺辫垂(楼)', data: monthKeys2.map(function(m){ return monthMap[m].adSpend; }),
            borderColor: CHART_PALETTE.orange.line, backgroundColor: CHART_PALETTE.orange.fill,
            borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: CHART_PALETTE.orange.line,
            fill: true, tension: 0.4, yAxisID: 'y' },
          { label: '璁垮鏁?, data: monthKeys2.map(function(m){ return monthMap[m].visitors; }),
            borderColor: CHART_PALETTE.purple.line, backgroundColor: 'transparent',
            borderWidth: 2, pointRadius: 4, pointBackgroundColor: CHART_PALETTE.purple.line,
            fill: false, tension: 0.4, yAxisID: 'y1', borderDash: [5, 3] },
          { label: '绾跨储鏁?, data: monthKeys2.map(function(m){ return monthMap[m].leads; }),
            borderColor: CHART_PALETTE.green.line, backgroundColor: 'transparent',
            borderWidth: 2, pointRadius: 4, pointBackgroundColor: CHART_PALETTE.green.line,
            fill: false, tension: 0.4, yAxisID: 'y' }
        ]
      },
      options: {
        plugins: {
          legend: { labels: { color: '#1a1a2e', font: { size: 13 } } },
          datalabels: { display: false }
        },
        scales: {
          y:  { position: 'left',  title: { display: true, text: '鑺辫垂(楼) / 绾跨储', color: '#555' }, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#555' } },
          y1: { position: 'right', title: { display: true, text: '璁垮鏁?, color: '#555' }, grid: { drawOnChartArea: false }, ticks: { color: '#555' } }
        }
      }
    }, 1200, 300);

    var extraStyles = ' h2{color:#1a1a2e;margin:24px 0 8px;font-size:16px;border-bottom:2px solid #1a1a2e;padding-bottom:4px;}';
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + styles + extraStyles + '</style></head><body>' +
      '<div class="rpt-wrap">' +
      '<div class="rpt-title">馃搳 骞村害姹囨€绘姤鍛婏紙' + selectedYears.join('銆?) + '骞达級</div>' +
      '<div class="rpt-subtitle">姹夐缚搴楅摵 路 闃块噷宸村反鏁版嵁鎴樻儏瀹?/div>' +
      '<div class="rpt-meta"><span>鏁版嵁璺ㄥ害锛? + (monthKeys2[0] || '鈥?) + ' 鑷?' + (monthKeys2[monthKeys2.length - 1] || '鈥?) + '</span><span>鐢熸垚鏃堕棿锛? + new Date().toLocaleString('zh-CN') + '</span></div>' +
      '<div class="kpi-grid">' +
      '<div class="kpi-box"><div class="kpi-val">' + totalAll.inquiries + '</div><div class="kpi-lbl">绱璇㈢洏</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totalAll.visitors.toLocaleString() + '</div><div class="kpi-lbl">绱璁垮</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">楼' + totalAll.adSpend.toFixed(0) + '</div><div class="kpi-lbl">绱骞垮憡鑺辫垂</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">楼' + totalAll.deals.toLocaleString() + '</div><div class="kpi-lbl">绱鎴愪氦閲戦</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + pct(totalAll.inquiries, totalAll.visitors) + '</div><div class="kpi-lbl">缁煎悎璇㈢洏杞寲鐜?/div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totalAll.leads + '</div><div class="kpi-lbl">绱绾跨储</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + (totalAll.leads > 0 ? '楼' + (totalAll.adSpend / totalAll.leads).toFixed(2) : '鈥?) + '</div><div class="kpi-lbl">缁煎悎鍗曠嚎绱㈡垚鏈?/div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totalRoi + '</div><div class="kpi-lbl">缁煎悎ROI</div></div>' +
      '</div>' +
      chartSection('鏈堝害璇㈢洏 & 鎴愪氦閲戦瓒嬪娍', chart5Img) +
      chartSection('鏈堝害骞垮憡鑺辫垂 路 璁垮 路 绾跨储瓒嬪娍', chart6Img) +
      '<h2>鈻?骞村害瀵规瘮锛堟寜骞存眹鎬伙級</h2>' +
      '<table><thead><tr><th>骞翠唤</th><th>灞曠幇閲?/th><th>璁垮鏁?/th><th>璇㈢洏鏁?/th><th>鎺ュ緟鏁?/th><th>璇㈢洏杞寲鐜?/th><th>鎺ュ緟杞寲鐜?/th><th>骞垮憡鑺辫垂</th><th>绾跨储</th><th>鍗曠嚎绱㈡垚鏈?/th><th>鎴愪氦閲戦</th><th>鎴愪氦绗旀暟</th><th>ROI</th><th>璇㈢洏骞村悓姣?/th></tr></thead><tbody>' + yearRows + '</tbody></table>' +
      '<h2>鈻?鏈堝害鏄庣粏锛堟墍鏈夋湀浠斤級</h2>' +
      '<table><thead><tr><th>鏈堜唤</th><th>璁垮鏁?/th><th>璇㈢洏鏁?/th><th>鎺ュ緟鏁?/th><th>璇㈢洏杞寲鐜?/th><th>骞垮憡鑺辫垂</th><th>绾跨储</th><th>鎴愪氦閲戦</th><th>ROI</th><th>鏈堣鐩樼幆姣?/th></tr></thead><tbody>' + monthRows + '</tbody></table>' +
      '</div></body></html>';

    var tempContainer = document.createElement('div');
    tempContainer.innerHTML = html;
    tempContainer.style.cssText = 'position:absolute;left:-10000px;background:white;padding:20px;color:#000;width:1300px;';
    document.body.appendChild(tempContainer);
    try {
      var canvas = await html2canvas(tempContainer, { scale: 1.5, backgroundColor: '#ffffff', logging: false, useCORS: true });
      var pdfW = 297;
      var pdfH = Math.ceil(canvas.height * pdfW / canvas.width);
      var pdf = new jspdf.jsPDF({ orientation: 'l', unit: 'mm', format: [pdfW, pdfH] });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfW, pdfH);
      pdf.save('骞村害姹囨€籣' + selectedYears.join('-') + '.pdf');
      alert('鉁?骞村害姹囨€诲凡涓嬭浇锛? + selectedYears.join('銆?) + '骞达紝瀹屾暣鍗曢〉鏃犳埅鏂級');
    } catch (err) {
      alert('瀵煎嚭澶辫触锛? + (err && err.message ? err.message : String(err)));
    } finally {
      document.body.removeChild(tempContainer);
    }
  }

  function initChartModal() {
    var modal = document.getElementById('myModal');
    var closeBtn = modal.querySelector('.close');
    var hide = function () {
      modal.style.display = 'none';
    };
    closeBtn.addEventListener('click', hide);
    closeBtn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        hide();
      }
    });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) hide();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.style.display === 'block') hide();
    });
  }

  window.loadData = loadData;
  window.switchMonth = switchMonth;
  window.downloadWeeklySummary = downloadWeeklySummary;
  window.downloadMonthlySummary = downloadMonthlySummary;
  window.downloadAnnualSummary = downloadAnnualSummary;
  window.exportChartPng = exportChartPng;

  Chart.register(ChartDataLabels);
  Chart.defaults.color = '#b8ecff';
  Chart.defaults.borderColor = 'rgba(0, 255, 255, 0.12)';
  Chart.defaults.font.family = "'Rajdhani', 'Segoe UI', system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.animation.duration = 700;
  Chart.defaults.maintainAspectRatio = true;
  Chart.defaults.onClick = function (_evt, elements, chart) {
    if (!elements || elements.length === 0) return;
    var m = document.getElementById('myModal');
    var img = document.getElementById('enlargedChartImg');
    if (!m || !img) return;
    img.src = chart.toBase64Image();
    img.alt = '鍥捐〃棰勮';
    m.style.display = 'block';
  };

  initChartModal();
  loadData();
})();


