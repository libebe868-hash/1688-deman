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

  function getWeekNumber(date) {
    var start = new Date(date.getFullYear(), 0, 1);
    var diff = date - start + (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60000;
    var oneWeek = 86400000 * 7;
    return Math.ceil(diff / oneWeek);
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
      alert('html2canvas 未加载，请检查网络后刷新页面。');
      return false;
    }
    if (typeof jspdf === 'undefined' || !jspdf.jsPDF) {
      alert('jsPDF 未加载，请检查网络后刷新页面。');
      return false;
    }
    return true;
  }

  function pdfAddImageMultipage(pdf, imgData, imgWidth, imgHeight) {
    var pageH = 297;
    var heightLeft = imgHeight;
    var position = 0;
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageH;
    while (heightLeft >= 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageH;
    }
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
      '<strong>数据解析提示</strong>（' +
      lastParseWarnings.length +
      ' 条）<br>' +
      lastParseWarnings.map(function (w) {
        return '· ' + w;
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
    if (!jr.ok) throw new Error('JSON 接口 ' + jr.status);
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
    loadingEl.innerHTML = '加载数据中...';
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
        if (!jr.ok) throw new Error('JSON 接口 ' + jr.status);
        var json = await jr.json();
        rows = HanhongData.normalizeApiPayload(json);
      } else {
        var url = cfg.dataXlsxUrl || 'data.xlsx';
        var response = await fetch(url + '?t=' + Date.now());
        if (!response.ok) throw new Error(url + ' 未找到 (' + response.status + ')');
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

      loadingEl.textContent = '已加载 ' + allData.length + ' 天数据';
      initMonthSelector();
      var latestMonth = format(allData[allData.length - 1].date, 'yyyy-MM');
      applyViewMonth(latestMonth);
    } catch (e) {
      loadingEl.innerHTML =
        '<span style="color:#ff6b9d">加载失败：' +
        (e && e.message ? e.message : String(e)) +
        '</span><br><br>' +
        '<button type="button" class="btn" onclick="loadData()">重试</button>';
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
    container.innerHTML = '<strong style="color:#00ffff; margin-right:10px;">月份切换：</strong>';
    var select = document.createElement('select');
    select.className = 'month-select';
    select.setAttribute('aria-label', '选择统计月份');
    var allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = '全部时间';
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
        alert('按月拉取失败：' + (err && err.message ? err.message : String(err)));
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

    var momInq = '—';
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
        momInq = '∞%';
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
    safeText('costPerLead', '¥' + costPerLead);
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
            { label: '总展现', data: displayData.map(function (d) {
              return d.totalExp;
            }), borderColor: '#00ffff', tension: 0.4, yAxisID: 'y' },
            { label: '访客', data: displayData.map(function (d) {
              return d.visitors;
            }), borderColor: '#ff00ff', tension: 0.4, yAxisID: 'y1' },
            { label: '询盘', data: displayData.map(function (d) {
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
          labels: ['广告展现', '自然展现'],
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
        var week = getWeekNumber(d.date);
        if (!weeks[week]) weeks[week] = { inquiries: 0, reception: 0 };
        weeks[week].inquiries += d.inquiries;
        weeks[week].reception += d.reception;
      });
      var weekLabels = Object.keys(weeks).sort(function (a, b) {
        return a - b;
      });
      new Chart(document.getElementById('weeklyChart'), {
        type: 'line',
        data: {
          labels: weekLabels.map(function (w) {
            return '第' + w + '周';
          }),
          datasets: [
            { label: '周询盘', data: weekLabels.map(function (w) {
              return weeks[w].inquiries;
            }), borderColor: '#ff00ff', tension: 0.4 },
            { label: '周接待', data: weekLabels.map(function (w) {
              return weeks[w].reception;
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
      new Chart(document.getElementById('funnelChart'), {
        type: 'bar',
        data: {
          labels: ['总展现', '访客', '询盘', '接待'],
          datasets: [
            {
              data: [total.totalExp, total.visitors, total.inquiries, total.reception],
              backgroundColor: ['#00ffff', '#ff00ff', '#ffff00', '#00ff88']
            }
          ]
        },
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: false }, datalabels: { display: false } },
          scales: { x: { display: false } }
        }
      });
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
          datasets: [{ label: '月询盘', data: monthLabels.map(function (m) {
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
              label: '增长率%',
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
        return '未来' + (i + 1) + '天';
      });
      new Chart(document.getElementById('naturalFlowChart'), {
        type: 'line',
        data: {
          labels: labels.concat(futureLabels),
          datasets: [
            { label: '自然流量', data: naturalData.concat(Array(7).fill(null)), borderColor: '#00ffff', tension: 0.4 },
            {
              label: '预测',
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
          datasets: [{ label: '广告花费', data: displayData.map(function (d) {
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
          datasets: [{ label: '线索', data: displayData.map(function (d) {
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
          datasets: [{ label: '成交', data: displayData.map(function (d) {
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
            { label: '广告花费', data: displayData.map(function (d) {
              return d.adSpend;
            }), borderColor: '#ff00ff', tension: 0.4, yAxisID: 'y' },
            { label: '成交金额', data: displayData.map(function (d) {
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
            { label: '接待', data: displayData.map(function (d) {
              return d.reception;
            }), borderColor: '#00ff88', tension: 0.4 },
            { label: '询盘', data: displayData.map(function (d) {
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
      alert('图表尚未渲染，请先滚动到该区域。');
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
      '.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0;}',
      '.kpi-box{border:1px solid #dde;border-radius:8px;padding:14px 10px;text-align:center;}',
      '.kpi-val{font-size:22px;font-weight:bold;color:#1a1a2e;}',
      '.kpi-lbl{font-size:11px;color:#777;margin-top:4px;}'
    ].join('');
  }

  function pct(a, b) {
    if (!b) return '—';
    return ((a / b) * 100).toFixed(2) + '%';
  }

  function momStr(cur, prev) {
    if (!prev) return cur > 0 ? '<span class="pos">+∞%</span>' : '—';
    var r = ((cur / prev - 1) * 100).toFixed(1);
    return r >= 0
      ? '<span class="pos">▲' + r + '%</span>'
      : '<span class="neg">▼' + Math.abs(r) + '%</span>';
  }

  // 在离屏canvas上渲染Chart.js图表，返回base64图片字符串
  function renderChartToBase64(config, w, h) {
    return new Promise(function (resolve) {
      var cvs = document.createElement('canvas');
      cvs.width = w || 1100;
      cvs.height = h || 300;
      cvs.style.cssText = 'position:absolute;left:-30000px;top:0;';
      document.body.appendChild(cvs);
      // 关闭动画保证立即可截图
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

  // 公用折线图颜色方案
  var CHART_PALETTE = {
    blue:   { line: '#2563eb', fill: 'rgba(37,99,235,0.08)' },
    pink:   { line: '#db2777', fill: 'rgba(219,39,119,0.08)' },
    green:  { line: '#059669', fill: 'rgba(5,150,105,0.08)' },
    orange: { line: '#d97706', fill: 'rgba(217,119,6,0.08)' },
    purple: { line: '#7c3aed', fill: 'rgba(124,58,237,0.08)' }
  };

  function chartSection(title, imgSrc) {
    return '<div style="margin:24px 0 8px;font-size:15px;font-weight:bold;color:#1a1a2e;border-bottom:2px solid #1a1a2e;padding-bottom:4px;">▌ ' + title + '</div>' +
      '<img src="' + imgSrc + '" style="width:100%;border:1px solid #e0e0e0;border-radius:6px;display:block;" />';
  }

  async function downloadWeeklySummary() {
    var displayData = currentMonth
      ? allData.filter(function (d) { return format(d.date, 'yyyy-MM') === currentMonth; })
      : allData;

    var weeks = {};
    displayData.forEach(function (d) {
      var week = getWeekNumber(d.date);
      if (!weeks[week]) {
        weeks[week] = {
          inquiries: 0, reception: 0, visitors: 0, adSpend: 0,
          leads: 0, deals: 0, totalExp: 0, adExp: 0,
          minDate: d.date, maxDate: d.date
        };
      }
      var w = weeks[week];
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

    var weekKeys = Object.keys(weeks).sort(function (a, b) { return a - b; });
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
    var cols = ['周号', '日期范围', '展现量', '访客数', '询盘数', '接待数', '询盘转化率', '接待转化率',
                '广告花费', '线索数', '单线索成本', '成交金额', 'ROI', '周询盘环比'];
    var thRow = cols.map(function (c) { return '<th>' + c + '</th>'; }).join('');

    var rows = '';
    weekKeys.forEach(function (wk, i) {
      var w = weeks[wk];
      var prev = i > 0 ? weeks[weekKeys[i - 1]] : null;
      var dateRng = format(w.minDate, 'MM-dd') + '~' + format(w.maxDate, 'MM-dd');
      var roi = w.adSpend > 0 ? ((w.deals / w.adSpend) * 100).toFixed(1) + '%' : '—';
      var cpl = w.leads > 0 ? '¥' + (w.adSpend / w.leads).toFixed(2) : '—';
      rows += '<tr>' +
        '<td><b>第' + wk + '周</b></td>' +
        '<td>' + dateRng + '</td>' +
        '<td>' + w.totalExp.toLocaleString() + '</td>' +
        '<td>' + w.visitors.toLocaleString() + '</td>' +
        '<td><b>' + w.inquiries + '</b></td>' +
        '<td>' + w.reception + '</td>' +
        '<td>' + pct(w.inquiries, w.visitors) + '</td>' +
        '<td>' + pct(w.reception, w.inquiries) + '</td>' +
        '<td>¥' + w.adSpend.toFixed(2) + '</td>' +
        '<td>' + w.leads + '</td>' +
        '<td>' + cpl + '</td>' +
        '<td>¥' + w.deals.toLocaleString() + '</td>' +
        '<td>' + roi + '</td>' +
        '<td>' + (prev ? momStr(w.inquiries, prev.inquiries) : '—') + '</td>' +
        '</tr>';
    });

    var totalRoi = totals.adSpend > 0 ? ((totals.deals / totals.adSpend) * 100).toFixed(1) + '%' : '—';
    var totalCpl = totals.leads > 0 ? '¥' + (totals.adSpend / totals.leads).toFixed(2) : '—';
    rows += '<tr class="total-row">' +
      '<td colspan="2"><b>合 计</b></td>' +
      '<td>' + totals.totalExp.toLocaleString() + '</td>' +
      '<td>' + totals.visitors.toLocaleString() + '</td>' +
      '<td><b>' + totals.inquiries + '</b></td>' +
      '<td>' + totals.reception + '</td>' +
      '<td>' + pct(totals.inquiries, totals.visitors) + '</td>' +
      '<td>' + pct(totals.reception, totals.inquiries) + '</td>' +
      '<td>¥' + totals.adSpend.toFixed(2) + '</td>' +
      '<td>' + totals.leads + '</td>' +
      '<td>' + totalCpl + '</td>' +
      '<td>¥' + totals.deals.toLocaleString() + '</td>' +
      '<td>' + totalRoi + '</td>' +
      '<td>—</td>' +
      '</tr>';

    var rangeLabel = currentMonth ? currentMonth + ' 月' : '全部时间';
    if (!assertPdfLibs()) return;

    // ── 生成折线图1：周询盘 + 周接待 + 周访客 ──
    var wkLabels = weekKeys.map(function (w) { return '第' + w + '周'; });
    var chart1Img = await renderChartToBase64({
      type: 'line',
      data: {
        labels: wkLabels,
        datasets: [
          { label: '询盘数', data: weekKeys.map(function(w){ return weeks[w].inquiries; }),
            borderColor: CHART_PALETTE.blue.line, backgroundColor: CHART_PALETTE.blue.fill,
            borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: CHART_PALETTE.blue.line, fill: true, tension: 0.35, yAxisID: 'y' },
          { label: '接待数', data: weekKeys.map(function(w){ return weeks[w].reception; }),
            borderColor: CHART_PALETTE.green.line, backgroundColor: CHART_PALETTE.green.fill,
            borderWidth: 2, pointRadius: 4, pointBackgroundColor: CHART_PALETTE.green.line, fill: false, tension: 0.35, yAxisID: 'y' },
          { label: '访客数', data: weekKeys.map(function(w){ return weeks[w].visitors; }),
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
          y:  { position: 'left',  title: { display: true, text: '询盘 / 接待', color: '#555' }, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#555' } },
          y1: { position: 'right', title: { display: true, text: '访客数', color: '#555' }, grid: { drawOnChartArea: false }, ticks: { color: '#555' } }
        }
      }
    }, 1120, 310);

    // ── 生成折线图2：广告花费 vs 成交金额 ──
    var chart2Img = await renderChartToBase64({
      type: 'line',
      data: {
        labels: wkLabels,
        datasets: [
          { label: '广告花费(¥)', data: weekKeys.map(function(w){ return weeks[w].adSpend; }),
            borderColor: CHART_PALETTE.orange.line, backgroundColor: CHART_PALETTE.orange.fill,
            borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: CHART_PALETTE.orange.line, fill: true, tension: 0.35, yAxisID: 'y' },
          { label: '成交金额(¥)', data: weekKeys.map(function(w){ return weeks[w].deals; }),
            borderColor: CHART_PALETTE.pink.line, backgroundColor: CHART_PALETTE.pink.fill,
            borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: CHART_PALETTE.pink.line, fill: false, tension: 0.35, yAxisID: 'y1' }
        ]
      },
      options: {
        plugins: {
          legend: { labels: { color: '#1a1a2e', font: { size: 13 } } },
          datalabels: { display: false }
        },
        scales: {
          y:  { position: 'left',  title: { display: true, text: '广告花费(¥)', color: '#555' }, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#555' } },
          y1: { position: 'right', title: { display: true, text: '成交金额(¥)', color: '#555' }, grid: { drawOnChartArea: false }, ticks: { color: '#555' } }
        }
      }
    }, 1120, 310);

    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + styles + '</style></head><body>' +
      '<div class="rpt-wrap">' +
      '<div class="rpt-title">📊 周度汇总报告</div>' +
      '<div class="rpt-subtitle">汉鸿店铺 · 阿里巴巴数据战情室</div>' +
      '<div class="rpt-meta"><span>统计范围：' + rangeLabel + '</span><span>生成时间：' + new Date().toLocaleString('zh-CN') + '</span></div>' +
      '<div class="kpi-grid">' +
      '<div class="kpi-box"><div class="kpi-val">' + totals.inquiries + '</div><div class="kpi-lbl">总询盘数</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">¥' + totals.adSpend.toFixed(0) + '</div><div class="kpi-lbl">总广告花费</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">¥' + totals.deals.toLocaleString() + '</div><div class="kpi-lbl">总成交金额</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totalRoi + '</div><div class="kpi-lbl">总ROI</div></div>' +
      '</div>' +
      chartSection('周询盘 · 接待 · 访客趋势', chart1Img) +
      chartSection('周广告花费 vs 成交金额', chart2Img) +
      '<div style="margin:20px 0 6px;font-size:15px;font-weight:bold;color:#1a1a2e;border-bottom:2px solid #1a1a2e;padding-bottom:4px;">▌ 周度明细数据</div>' +
      '<table><thead><tr>' + thRow + '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div></body></html>';

    var tempContainer = document.createElement('div');
    tempContainer.innerHTML = html;
    tempContainer.style.cssText = 'position:absolute;left:-10000px;background:white;padding:20px;color:#000;width:1200px;';
    document.body.appendChild(tempContainer);
    try {
      var canvas = await html2canvas(tempContainer, { scale: 1.5, backgroundColor: '#ffffff', logging: false, useCORS: true });
      var pdf = new jspdf.jsPDF('l', 'mm', 'a4');
      var imgData = canvas.toDataURL('image/png');
      var imgWidth = 297;
      var imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdfAddImageMultipage(pdf, imgData, imgWidth, imgHeight);
      pdf.save('周度汇总_' + (currentMonth || '全期') + '.pdf');
      alert('✅ 周度汇总已下载（含趋势图 + 数据表）');
    } catch (err) {
      alert('导出失败：' + (err && err.message ? err.message : String(err)));
    } finally {
      document.body.removeChild(tempContainer);
    }
  }

  async function downloadMonthlySummary() {
    var months = {};
    allData.forEach(function (d) {
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
    var cols = ['月份', '展现量', '访客数', '询盘数', '接待数', '询盘转化率', '接待转化率',
                '广告花费', '广告占比', '线索数', '单线索成本', '成交金额', 'ROI', '月询盘环比'];
    var thRow = cols.map(function (c) { return '<th>' + c + '</th>'; }).join('');

    var rows = '';
    monthKeys.forEach(function (mk, i) {
      var m = months[mk];
      var prev = i > 0 ? months[monthKeys[i - 1]] : null;
      var roi = m.adSpend > 0 ? ((m.deals / m.adSpend) * 100).toFixed(1) + '%' : '—';
      var cpl = m.leads > 0 ? '¥' + (m.adSpend / m.leads).toFixed(2) : '—';
      var adPct = m.totalExp > 0 ? ((m.adExp / m.totalExp) * 100).toFixed(1) + '%' : '—';
      rows += '<tr>' +
        '<td><b>' + mk + '</b></td>' +
        '<td>' + m.totalExp.toLocaleString() + '</td>' +
        '<td>' + m.visitors.toLocaleString() + '</td>' +
        '<td><b>' + m.inquiries + '</b></td>' +
        '<td>' + m.reception + '</td>' +
        '<td>' + pct(m.inquiries, m.visitors) + '</td>' +
        '<td>' + pct(m.reception, m.inquiries) + '</td>' +
        '<td>¥' + m.adSpend.toFixed(2) + '</td>' +
        '<td>' + adPct + '</td>' +
        '<td>' + m.leads + '</td>' +
        '<td>' + cpl + '</td>' +
        '<td>¥' + m.deals.toLocaleString() + '</td>' +
        '<td>' + roi + '</td>' +
        '<td>' + (prev ? momStr(m.inquiries, prev.inquiries) : '—') + '</td>' +
        '</tr>';
    });

    var totalRoi = totals.adSpend > 0 ? ((totals.deals / totals.adSpend) * 100).toFixed(1) + '%' : '—';
    var totalCpl = totals.leads > 0 ? '¥' + (totals.adSpend / totals.leads).toFixed(2) : '—';
    rows += '<tr class="total-row">' +
      '<td><b>合 计</b></td>' +
      '<td>' + totals.totalExp.toLocaleString() + '</td>' +
      '<td>' + totals.visitors.toLocaleString() + '</td>' +
      '<td><b>' + totals.inquiries + '</b></td>' +
      '<td>' + totals.reception + '</td>' +
      '<td>' + pct(totals.inquiries, totals.visitors) + '</td>' +
      '<td>' + pct(totals.reception, totals.inquiries) + '</td>' +
      '<td>¥' + totals.adSpend.toFixed(2) + '</td>' +
      '<td>—</td>' +
      '<td>' + totals.leads + '</td>' +
      '<td>' + totalCpl + '</td>' +
      '<td>¥' + totals.deals.toLocaleString() + '</td>' +
      '<td>' + totalRoi + '</td>' +
      '<td>—</td>' +
      '</tr>';

    if (!assertPdfLibs()) return;

    // ── 生成折线图1：月度询盘 + 接待 + 访客 ──
    var chart3Img = await renderChartToBase64({
      type: 'line',
      data: {
        labels: monthKeys,
        datasets: [
          { label: '询盘数', data: monthKeys.map(function(m){ return months[m].inquiries; }),
            borderColor: CHART_PALETTE.blue.line, backgroundColor: CHART_PALETTE.blue.fill,
            borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: CHART_PALETTE.blue.line, fill: true, tension: 0.4, yAxisID: 'y' },
          { label: '接待数', data: monthKeys.map(function(m){ return months[m].reception; }),
            borderColor: CHART_PALETTE.green.line, backgroundColor: CHART_PALETTE.green.fill,
            borderWidth: 2, pointRadius: 4, pointBackgroundColor: CHART_PALETTE.green.line, fill: false, tension: 0.4, yAxisID: 'y' },
          { label: '访客数', data: monthKeys.map(function(m){ return months[m].visitors; }),
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
          y:  { position: 'left',  title: { display: true, text: '询盘 / 接待', color: '#555' }, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#555' } },
          y1: { position: 'right', title: { display: true, text: '访客数', color: '#555' }, grid: { drawOnChartArea: false }, ticks: { color: '#555' } }
        }
      }
    }, 1200, 320);

    // ── 生成折线图2：广告花费(柱) + ROI(线) ──
    var roiData = monthKeys.map(function(m) {
      var mo = months[m];
      return mo.adSpend > 0 ? parseFloat(((mo.deals / mo.adSpend) * 100).toFixed(1)) : 0;
    });
    var chart4Img = await renderChartToBase64({
      type: 'bar',
      data: {
        labels: monthKeys,
        datasets: [
          { type: 'bar', label: '广告花费(¥)',
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
          y:  { position: 'left',  title: { display: true, text: '广告花费(¥)', color: '#555' }, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#555' } },
          y1: { position: 'right', title: { display: true, text: 'ROI(%)', color: '#555' }, grid: { drawOnChartArea: false }, ticks: { color: '#555' } }
        }
      }
    }, 1200, 320);

    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + styles + '</style></head><body>' +
      '<div class="rpt-wrap">' +
      '<div class="rpt-title">📈 月度汇总报告</div>' +
      '<div class="rpt-subtitle">汉鸿店铺 · 阿里巴巴数据战情室</div>' +
      '<div class="rpt-meta"><span>统计月份数：' + monthKeys.length + ' 个月</span><span>生成时间：' + new Date().toLocaleString('zh-CN') + '</span></div>' +
      '<div class="kpi-grid">' +
      '<div class="kpi-box"><div class="kpi-val">' + totals.inquiries + '</div><div class="kpi-lbl">累计询盘</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">¥' + totals.adSpend.toFixed(0) + '</div><div class="kpi-lbl">累计广告花费</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">¥' + totals.deals.toLocaleString() + '</div><div class="kpi-lbl">累计成交金额</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totalRoi + '</div><div class="kpi-lbl">综合ROI</div></div>' +
      '</div>' +
      chartSection('月度询盘 · 接待 · 访客趋势', chart3Img) +
      chartSection('月度广告花费（柱）& ROI趋势（折线）', chart4Img) +
      '<div style="margin:20px 0 6px;font-size:15px;font-weight:bold;color:#1a1a2e;border-bottom:2px solid #1a1a2e;padding-bottom:4px;">▌ 月度明细数据</div>' +
      '<table><thead><tr>' + thRow + '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div></body></html>';

    var tempContainer = document.createElement('div');
    tempContainer.innerHTML = html;
    tempContainer.style.cssText = 'position:absolute;left:-10000px;background:white;padding:20px;color:#000;width:1300px;';
    document.body.appendChild(tempContainer);
    try {
      var canvas = await html2canvas(tempContainer, { scale: 1.5, backgroundColor: '#ffffff', logging: false, useCORS: true });
      var pdf = new jspdf.jsPDF('l', 'mm', 'a4');
      var imgData = canvas.toDataURL('image/png');
      var imgWidth = 297;
      var imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdfAddImageMultipage(pdf, imgData, imgWidth, imgHeight);
      pdf.save('月度汇总_' + new Date().getFullYear() + '.pdf');
      alert('✅ 月度汇总已下载（含趋势图 + 数据表）');
    } catch (err) {
      alert('导出失败：' + (err && err.message ? err.message : String(err)));
    } finally {
      document.body.removeChild(tempContainer);
    }
  }

  async function downloadAnnualSummary() {
    // 按年分组
    var years = {};
    allData.forEach(function (d) {
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

    // 同时按月汇总（用于月明细表）
    var monthMap = {};
    allData.forEach(function (d) {
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

    // 年度核心指标表
    var yearRows = '';
    yearKeys.forEach(function (yk, i) {
      var y = years[yk];
      var prev = i > 0 ? years[yearKeys[i - 1]] : null;
      var roi = y.adSpend > 0 ? ((y.deals / y.adSpend) * 100).toFixed(1) + '%' : '—';
      var cpl = y.leads > 0 ? '¥' + (y.adSpend / y.leads).toFixed(2) : '—';
      yearRows += '<tr>' +
        '<td><b>' + yk + '年</b></td>' +
        '<td>' + y.totalExp.toLocaleString() + '</td>' +
        '<td>' + y.visitors.toLocaleString() + '</td>' +
        '<td><b>' + y.inquiries + '</b></td>' +
        '<td>' + y.reception + '</td>' +
        '<td>' + pct(y.inquiries, y.visitors) + '</td>' +
        '<td>' + pct(y.reception, y.inquiries) + '</td>' +
        '<td>¥' + y.adSpend.toFixed(2) + '</td>' +
        '<td>' + y.leads + '</td>' +
        '<td>' + cpl + '</td>' +
        '<td>¥' + y.deals.toLocaleString() + '</td>' +
        '<td>' + (y.dealCount > 0 ? y.dealCount : '—') + '</td>' +
        '<td>' + roi + '</td>' +
        '<td>' + (prev ? momStr(y.inquiries, prev.inquiries) : '—') + '</td>' +
        '</tr>';
    });

    // 月明细表
    var monthKeys2 = Object.keys(monthMap).sort();
    var monthRows = '';
    monthKeys2.forEach(function (mk, i) {
      var m = monthMap[mk];
      var prev = i > 0 ? monthMap[monthKeys2[i - 1]] : null;
      var roi = m.adSpend > 0 ? ((m.deals / m.adSpend) * 100).toFixed(1) + '%' : '—';
      monthRows += '<tr>' +
        '<td><b>' + mk + '</b></td>' +
        '<td>' + m.visitors.toLocaleString() + '</td>' +
        '<td><b>' + m.inquiries + '</b></td>' +
        '<td>' + m.reception + '</td>' +
        '<td>' + pct(m.inquiries, m.visitors) + '</td>' +
        '<td>¥' + m.adSpend.toFixed(2) + '</td>' +
        '<td>' + m.leads + '</td>' +
        '<td>¥' + m.deals.toLocaleString() + '</td>' +
        '<td>' + roi + '</td>' +
        '<td>' + (prev ? momStr(m.inquiries, prev.inquiries) : '—') + '</td>' +
        '</tr>';
    });

    var totalAll = allData.reduce(function (a, d) {
      return { inquiries: a.inquiries + d.inquiries, adSpend: a.adSpend + d.adSpend, deals: a.deals + d.deals, visitors: a.visitors + d.visitors, leads: a.leads + d.leads };
    }, { inquiries: 0, adSpend: 0, deals: 0, visitors: 0, leads: 0 });
    var totalRoi = totalAll.adSpend > 0 ? ((totalAll.deals / totalAll.adSpend) * 100).toFixed(1) + '%' : '—';

    if (!assertPdfLibs()) return;

    // ── 折线图1：月度询盘 + 成交金额双轴趋势 ──
    var chart5Img = await renderChartToBase64({
      type: 'line',
      data: {
        labels: monthKeys2,
        datasets: [
          { label: '月询盘', data: monthKeys2.map(function(m){ return monthMap[m].inquiries; }),
            borderColor: CHART_PALETTE.blue.line, backgroundColor: CHART_PALETTE.blue.fill,
            borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: CHART_PALETTE.blue.line,
            fill: true, tension: 0.4, yAxisID: 'y' },
          { label: '成交金额(¥)', data: monthKeys2.map(function(m){ return monthMap[m].deals; }),
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
          y:  { position: 'left',  title: { display: true, text: '月询盘数', color: '#555' }, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#555' } },
          y1: { position: 'right', title: { display: true, text: '成交金额(¥)', color: '#555' }, grid: { drawOnChartArea: false }, ticks: { color: '#555' } }
        }
      }
    }, 1200, 300);

    // ── 折线图2：月度广告花费 + 访客 + 线索 ──
    var chart6Img = await renderChartToBase64({
      type: 'line',
      data: {
        labels: monthKeys2,
        datasets: [
          { label: '广告花费(¥)', data: monthKeys2.map(function(m){ return monthMap[m].adSpend; }),
            borderColor: CHART_PALETTE.orange.line, backgroundColor: CHART_PALETTE.orange.fill,
            borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: CHART_PALETTE.orange.line,
            fill: true, tension: 0.4, yAxisID: 'y' },
          { label: '访客数', data: monthKeys2.map(function(m){ return monthMap[m].visitors; }),
            borderColor: CHART_PALETTE.purple.line, backgroundColor: 'transparent',
            borderWidth: 2, pointRadius: 4, pointBackgroundColor: CHART_PALETTE.purple.line,
            fill: false, tension: 0.4, yAxisID: 'y1', borderDash: [5, 3] },
          { label: '线索数', data: monthKeys2.map(function(m){ return monthMap[m].leads; }),
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
          y:  { position: 'left',  title: { display: true, text: '花费(¥) / 线索', color: '#555' }, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#555' } },
          y1: { position: 'right', title: { display: true, text: '访客数', color: '#555' }, grid: { drawOnChartArea: false }, ticks: { color: '#555' } }
        }
      }
    }, 1200, 300);

    var extraStyles = ' h2{color:#1a1a2e;margin:24px 0 8px;font-size:16px;border-bottom:2px solid #1a1a2e;padding-bottom:4px;}';
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + styles + extraStyles + '</style></head><body>' +
      '<div class="rpt-wrap">' +
      '<div class="rpt-title">📊 年度汇总报告</div>' +
      '<div class="rpt-subtitle">汉鸿店铺 · 阿里巴巴数据战情室</div>' +
      '<div class="rpt-meta"><span>数据跨度：' + (monthKeys2[0] || '—') + ' 至 ' + (monthKeys2[monthKeys2.length - 1] || '—') + '</span><span>生成时间：' + new Date().toLocaleString('zh-CN') + '</span></div>' +
      '<div class="kpi-grid">' +
      '<div class="kpi-box"><div class="kpi-val">' + totalAll.inquiries + '</div><div class="kpi-lbl">累计询盘</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totalAll.visitors.toLocaleString() + '</div><div class="kpi-lbl">累计访客</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">¥' + totalAll.adSpend.toFixed(0) + '</div><div class="kpi-lbl">累计广告花费</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">¥' + totalAll.deals.toLocaleString() + '</div><div class="kpi-lbl">累计成交金额</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + pct(totalAll.inquiries, totalAll.visitors) + '</div><div class="kpi-lbl">综合询盘转化率</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totalAll.leads + '</div><div class="kpi-lbl">累计线索</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + (totalAll.leads > 0 ? '¥' + (totalAll.adSpend / totalAll.leads).toFixed(2) : '—') + '</div><div class="kpi-lbl">综合单线索成本</div></div>' +
      '<div class="kpi-box"><div class="kpi-val">' + totalRoi + '</div><div class="kpi-lbl">综合ROI</div></div>' +
      '</div>' +
      chartSection('月度询盘 & 成交金额趋势', chart5Img) +
      chartSection('月度广告花费 · 访客 · 线索趋势', chart6Img) +
      '<h2>▌ 年度对比（按年汇总）</h2>' +
      '<table><thead><tr><th>年份</th><th>展现量</th><th>访客数</th><th>询盘数</th><th>接待数</th><th>询盘转化率</th><th>接待转化率</th><th>广告花费</th><th>线索</th><th>单线索成本</th><th>成交金额</th><th>成交笔数</th><th>ROI</th><th>询盘年同比</th></tr></thead><tbody>' + yearRows + '</tbody></table>' +
      '<h2>▌ 月度明细（所有月份）</h2>' +
      '<table><thead><tr><th>月份</th><th>访客数</th><th>询盘数</th><th>接待数</th><th>询盘转化率</th><th>广告花费</th><th>线索</th><th>成交金额</th><th>ROI</th><th>月询盘环比</th></tr></thead><tbody>' + monthRows + '</tbody></table>' +
      '</div></body></html>';

    var tempContainer = document.createElement('div');
    tempContainer.innerHTML = html;
    tempContainer.style.cssText = 'position:absolute;left:-10000px;background:white;padding:20px;color:#000;width:1300px;';
    document.body.appendChild(tempContainer);
    try {
      var canvas = await html2canvas(tempContainer, { scale: 1.5, backgroundColor: '#ffffff', logging: false, useCORS: true });
      var pdf = new jspdf.jsPDF('l', 'mm', 'a4');
      var imgData = canvas.toDataURL('image/png');
      var imgWidth = 297;
      var imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdfAddImageMultipage(pdf, imgData, imgWidth, imgHeight);
      pdf.save('年度汇总_' + new Date().getFullYear() + '.pdf');
      alert('✅ 年度汇总已下载（含趋势图 + 年对比 + 月明细）');
    } catch (err) {
      alert('导出失败：' + (err && err.message ? err.message : String(err)));
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
    img.alt = '图表预览';
    m.style.display = 'block';
  };

  initChartModal();
  loadData();
})();
