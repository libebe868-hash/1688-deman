/**
 * 大文件 XLSX 解析（主线程传 ArrayBuffer，避免阻塞 UI）
 */
importScripts('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');

self.onmessage = function (e) {
  const { arrayBuffer, sheetName } = e.data || {};
  try {
    if (!arrayBuffer) throw new Error('无文件数据');
    const wb = XLSX.read(arrayBuffer, { type: 'array', dense: true });
    const name = sheetName && wb.SheetNames.includes(sheetName)
      ? sheetName
      : wb.SheetNames[0];
    const sheet = wb.Sheets[name];
    if (!sheet) throw new Error('工作表为空');
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    self.postMessage({ ok: true, rows, sheetUsed: name });
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
};
