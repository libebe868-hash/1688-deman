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
    document.getElementById('stats').style.display = 'none';
    document.getElementById('charts').style.display = 'none';
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

    var costPerDealNum;
    var costPerDealSuffix = '';
    if (totalDealCount > 0) {
      costPerDealNum = (total.adSpend / totalDealCount).toFixed(2);
      costPerDealSuffix = '（÷成交笔数）';
    } else if (total.deals > 0) {
      costPerDealNum = ((total.adSpend / total.deals) * 100).toFixed(2);
      costPerDealSuffix = '% 广告÷成交金';
    } else {
      costPerDealNum = '0';
    }

    var avgDealNum;
    var avgDealLbl = '平均成交金额';
    if (totalDealCount > 0) {
      avgDealNum = (total.deals / totalDealCount).toFixed(2);
      avgDealLbl = '客单价(÷笔数)';
    } else if (total.inquiries > 0 && total.deals > 0) {
      avgDealNum = (total.deals / total.inquiries).toFixed(2);
      avgDealLbl = '询盘产值(÷询盘)';
    } else {
      avgDealNum = '0';
    }

    document.getElementById('totalExp').textContent = total.totalExp.toLocaleString();
    document.getElementById('totalVis').textContent = total.visitors.toLocaleString();
    document.getElementById('totalInq').textContent = total.inquiries;
    document.getElementById('totalRec').textContent = total.reception;
    document.getElementById('convRate').textContent = convRate.toFixed(2) + '%';
    document.getElementById('adRate').textContent =
      total.totalExp > 0 ? ((total.adExp / total.totalExp) * 100).toFixed(1) + '%' : '0%';
    document.getElementById('momInq').textContent = momInq;
    document.getElementById('clickRate').textContent = clickRate.toFixed(2) + '%';
    document.getElementById('totalAdSpend').textContent = total.adSpend.toFixed(2);
    document.getElementById('totalLeads').textContent = total.leads;
    document.getElementById('totalDeals').textContent = total.deals.toLocaleString();
    document.getElementById('roi').textContent = roi;
    document.getElementById('costPerLead').textContent = '¥' + costPerLead;
    var cpdEl = document.getElementById('costPerDeal');
    cpdEl.textContent = totalDealCount > 0 ? '¥' + costPerDealNum : costPerDealNum + (total.deals > 0 ? '%' : '');
    var cpdL = document.getElementById('costPerDealLabel');
    if (cpdL) cpdL.textContent = '单成交成本' + costPerDealSuffix;

    document.getElementById('avgDealValue').textContent = '¥' + avgDealNum;
    var avL = document.getElementById('avgDealLabel');
    if (avL) avL.textContent = avgDealLbl;

    document.getElementById('receptionRate').textContent = receptionRate.toFixed(2) + '%';
    document.getElementById('lastUpdate').textContent = new Date().toLocaleString('zh-CN');
    document.getElementById('loading').style.display = 'none';
    document.getElementById('stats').style.display = 'grid';
    document.getElementById('charts').style.display = 'grid';
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

  async function downloadWeeklySummary() {
    var displayData = currentMonth
      ? allData.filter(function (d) {
          return format(d.date, 'yyyy-MM') === currentMonth;
        })
      : allData;
    var weeks = {};
    displayData.forEach(function (d) {
      var week = getWeekNumber(d.date);
      if (!weeks[week]) weeks[week] = { inquiries: 0, reception: 0, visitors: 0, adSpend: 0, leads: 0, deals: 0 };
      weeks[week].inquiries += d.inquiries;
      weeks[week].reception += d.reception;
      weeks[week].visitors += d.visitors;
      weeks[week].adSpend += d.adSpend;
      weeks[week].leads += d.leads;
      weeks[week].deals += d.deals;
    });
    var htmlContent = '<h2 style="color:#00ffff; text-align:center;">📅 周度汇总报告</h2>';
    htmlContent +=
      '<p style="text-align:center; margin:10px 0;">范围: ' + (currentMonth ? currentMonth + ' 月' : '全部时间') + '</p>';
    htmlContent += '<table style="width:100%; border-collapse:collapse; margin-top:20px;">';
    htmlContent +=
      '<tr style="background:#00ffff; color:#000;"><th style="border:1px solid #000; padding:10px;">周号</th><th style="border:1px solid #000; padding:10px;">询盘数</th><th style="border:1px solid #000; padding:10px;">接待数</th><th style="border:1px solid #000; padding:10px;">访客数</th><th style="border:1px solid #000; padding:10px;">广告花费</th><th style="border:1px solid #000; padding:10px;">成交金额</th></tr>';
    Object.keys(weeks)
      .sort(function (a, b) {
        return a - b;
      })
      .forEach(function (week) {
        var w = weeks[week];
        htmlContent +=
          '<tr><td style="border:1px solid #000; padding:10px;">第' +
          week +
          '周</td><td style="border:1px solid #000; padding:10px;">' +
          w.inquiries +
          '</td><td style="border:1px solid #000; padding:10px;">' +
          w.reception +
          '</td><td style="border:1px solid #000; padding:10px;">' +
          w.visitors +
          '</td><td style="border:1px solid #000; padding:10px;">¥' +
          w.adSpend.toFixed(2) +
          '</td><td style="border:1px solid #000; padding:10px;">¥' +
          w.deals.toLocaleString() +
          '</td></tr>';
      });
    htmlContent += '</table>';
    var tempContainer = document.createElement('div');
    tempContainer.innerHTML = htmlContent;
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-10000px';
    tempContainer.style.background = 'white';
    tempContainer.style.padding = '20px';
    tempContainer.style.color = '#000';
    document.body.appendChild(tempContainer);
    if (!assertPdfLibs()) {
      document.body.removeChild(tempContainer);
      return;
    }
    try {
      var canvas = await html2canvas(tempContainer, html2canvasPdfOptions());
      var pdf = new jspdf.jsPDF('p', 'mm', 'a4');
      var imgData = canvas.toDataURL('image/png');
      var imgWidth = 210;
      var imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdfAddImageMultipage(pdf, imgData, imgWidth, imgHeight);
      pdf.save('周汇总_' + (currentMonth || '全期') + '.pdf');
      alert('周汇总已下载');
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
      if (!months[m]) months[m] = { inquiries: 0, reception: 0, visitors: 0, adSpend: 0, leads: 0, deals: 0 };
      months[m].inquiries += d.inquiries;
      months[m].reception += d.reception;
      months[m].visitors += d.visitors;
      months[m].adSpend += d.adSpend;
      months[m].leads += d.leads;
      months[m].deals += d.deals;
    });
    var htmlContent = '<h2 style="color:#00ffff; text-align:center;">📈 月度汇总报告</h2>';
    htmlContent += '<table style="width:100%; border-collapse:collapse; margin-top:20px;">';
    htmlContent +=
      '<tr style="background:#00ffff; color:#000;"><th style="border:1px solid #000; padding:10px;">月份</th><th style="border:1px solid #000; padding:10px;">询盘数</th><th style="border:1px solid #000; padding:10px;">接待数</th><th style="border:1px solid #000; padding:10px;">访客数</th><th style="border:1px solid #000; padding:10px;">广告花费</th><th style="border:1px solid #000; padding:10px;">成交金额</th></tr>';
    Object.keys(months)
      .sort()
      .forEach(function (month) {
        var mm = months[month];
        htmlContent +=
          '<tr><td style="border:1px solid #000; padding:10px;">' +
          month +
          '</td><td style="border:1px solid #000; padding:10px;">' +
          mm.inquiries +
          '</td><td style="border:1px solid #000; padding:10px;">' +
          mm.reception +
          '</td><td style="border:1px solid #000; padding:10px;">' +
          mm.visitors +
          '</td><td style="border:1px solid #000; padding:10px;">¥' +
          mm.adSpend.toFixed(2) +
          '</td><td style="border:1px solid #000; padding:10px;">¥' +
          mm.deals.toLocaleString() +
          '</td></tr>';
      });
    htmlContent += '</table>';
    var tempContainer = document.createElement('div');
    tempContainer.innerHTML = htmlContent;
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-10000px';
    tempContainer.style.background = 'white';
    tempContainer.style.padding = '20px';
    tempContainer.style.color = '#000';
    document.body.appendChild(tempContainer);
    if (!assertPdfLibs()) {
      document.body.removeChild(tempContainer);
      return;
    }
    try {
      var canvas = await html2canvas(tempContainer, html2canvasPdfOptions());
      var pdf = new jspdf.jsPDF('p', 'mm', 'a4');
      var imgData = canvas.toDataURL('image/png');
      var imgWidth = 210;
      var imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdfAddImageMultipage(pdf, imgData, imgWidth, imgHeight);
      pdf.save('月汇总_' + new Date().getFullYear() + '.pdf');
      alert('月汇总已下载');
    } catch (err) {
      alert('导出失败：' + (err && err.message ? err.message : String(err)));
    } finally {
      document.body.removeChild(tempContainer);
    }
  }

  async function downloadAnnualSummary() {
    var annualTotal = allData.reduce(
      function (acc, d) {
        return {
          totalExp: acc.totalExp + d.totalExp,
          visitors: acc.visitors + d.visitors,
          inquiries: acc.inquiries + d.inquiries,
          reception: acc.reception + d.reception,
          adSpend: acc.adSpend + d.adSpend,
          leads: acc.leads + d.leads,
          deals: acc.deals + d.deals,
          dealCount: acc.dealCount + (d.dealCount || 0),
          adExp: acc.adExp + d.adExp,
          naturalExp: acc.naturalExp + d.naturalExp
        };
      },
      {
        totalExp: 0,
        visitors: 0,
        inquiries: 0,
        reception: 0,
        adSpend: 0,
        leads: 0,
        deals: 0,
        dealCount: 0,
        adExp: 0,
        naturalExp: 0
      }
    );
    var convRate = annualTotal.visitors > 0 ? ((annualTotal.inquiries / annualTotal.visitors) * 100).toFixed(2) : 0;
    var roi = annualTotal.adSpend > 0 ? ((annualTotal.deals / annualTotal.adSpend) * 100).toFixed(2) : 0;
    var htmlContent = '<h2 style="color:#00ffff; text-align:center;">📊 年度汇总报告</h2>';
    htmlContent += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:20px;">';
    var items = [
      { label: '总展现量', value: annualTotal.totalExp.toLocaleString() },
      { label: '总访客数', value: annualTotal.visitors.toLocaleString() },
      { label: '询盘总数', value: annualTotal.inquiries },
      { label: '接待总数', value: annualTotal.reception },
      { label: '转化率', value: convRate + '%' },
      { label: '广告花费', value: '¥' + annualTotal.adSpend.toFixed(2) },
      { label: '总线索', value: annualTotal.leads },
      { label: '成交金额', value: '¥' + annualTotal.deals.toLocaleString() }
    ];
    if (annualTotal.dealCount > 0) {
      items.push({ label: '成交笔数', value: annualTotal.dealCount });
    }
    items.push({ label: 'ROI', value: roi + '%' });
    items.forEach(function (item) {
      htmlContent +=
        '<div style="border:1px solid #000; padding:15px; background:#f5f5f5;">' +
        '<div style="color:#666; font-size:12px;">' +
        item.label +
        '</div>' +
        '<div style="color:#000; font-size:20px; font-weight:bold;">' +
        item.value +
        '</div></div>';
    });
    htmlContent += '</div>';
    var tempContainer = document.createElement('div');
    tempContainer.innerHTML = htmlContent;
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-10000px';
    tempContainer.style.background = 'white';
    tempContainer.style.padding = '20px';
    tempContainer.style.color = '#000';
    document.body.appendChild(tempContainer);
    if (!assertPdfLibs()) {
      document.body.removeChild(tempContainer);
      return;
    }
    try {
      var canvas = await html2canvas(tempContainer, html2canvasPdfOptions());
      var pdf = new jspdf.jsPDF('p', 'mm', 'a4');
      var imgData = canvas.toDataURL('image/png');
      var imgWidth = 210;
      var imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdfAddImageMultipage(pdf, imgData, imgWidth, imgHeight);
      pdf.save('年度汇总_' + new Date().getFullYear() + '.pdf');
      alert('年度汇总已下载');
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
