/* Phone version: interface texts that talk about server.py, run.bat or "this computer".
   Only overrides keys that exist; everything else is the desktop text. */
import { I18N } from './js/i18n.js';

const RESTART = { zh: '请把 App 完全关掉再打开（上滑关掉），或者刷新页面。', en: 'Close the app completely and open it again (swipe it away), or reload the page.',
  de: 'Schließe die App ganz und öffne sie wieder (wegwischen) oder lade die Seite neu.' };
const OVERRIDE = {
  zh: {
    keyHint: '只保存在这台手机的浏览器里，页面不会再显示它。',
    dedupeHint: '本地方式在手机上比对最近出过的题，命中重复话题词的句子会被丢弃；旧方式作为备用，随时可切回。',
    dbPath: '历史保存在：',
    noServerDlg: '后台没有启动成功：这里的设置没法保存，也没法连接模型。' + RESTART.zh,
    noServerNet: '后台没有响应（{e}）。' + RESTART.zh, noServerShort: '后台没有启动',
    noServerNote: '后台没有启动成功，所以没法连接模型，设置也没法保存。\n' + RESTART.zh,
    dbNoServer: '后台没有启动成功：历史不会保存。' + RESTART.zh, toastNoServer: '后台没有启动成功：设置和历史都不会保存。' + RESTART.zh,
    oldServer: 'App 刚更新过，新旧文件混在一起了。' + RESTART.zh,
  },
  en: {
    keyHint: "Stored only in this phone's browser; the page never shows it again.",
    dedupeHint: 'The local way compares new sentences with recent ones on this phone and drops those that repeat a topic word; the old way stays available as a fallback.',
    dbPath: 'The history is saved in: ',
    noServerDlg: 'The app did not start properly: settings cannot be saved and no model can be reached. ' + RESTART.en,
    noServerNet: 'The app is not responding ({e}). ' + RESTART.en, noServerShort: 'App not started',
    noServerNote: 'The app did not start properly, so no model can be reached and settings cannot be saved.\n' + RESTART.en,
    dbNoServer: 'The app did not start properly: the history is not saved. ' + RESTART.en, toastNoServer: 'The app did not start properly: settings and history are not saved. ' + RESTART.en,
    oldServer: 'The app was just updated and old and new files are mixed. ' + RESTART.en,
  },
  de: {
    keyHint: 'Wird nur im Browser dieses Handys gespeichert; die Seite zeigt ihn nie wieder an.',
    dedupeHint: 'Lokal werden neue Sätze auf diesem Handy mit den letzten verglichen; Sätze mit einem wiederholten Themenwort fallen weg. Die alte Methode bleibt als Reserve.',
    dbPath: 'Der Verlauf wird gespeichert: ',
    noServerDlg: 'Die App ist nicht richtig gestartet: Einstellungen werden nicht gespeichert, kein Modell erreichbar. ' + RESTART.de,
    noServerNet: 'Die App antwortet nicht ({e}). ' + RESTART.de, noServerShort: 'App nicht gestartet',
    noServerNote: 'Die App ist nicht richtig gestartet – daher kein Modell und keine gespeicherten Einstellungen.\n' + RESTART.de,
    dbNoServer: 'Die App ist nicht richtig gestartet: Der Verlauf wird nicht gespeichert. ' + RESTART.de, toastNoServer: 'Die App ist nicht richtig gestartet: Einstellungen und Verlauf werden nicht gespeichert. ' + RESTART.de,
    oldServer: 'Die App wurde gerade aktualisiert, alte und neue Dateien sind gemischt. ' + RESTART.de,
  },
};
for (const [lang, keys] of Object.entries(OVERRIDE)) {
  const d = I18N[lang];
  if (!d) continue;
  for (const [k, v] of Object.entries(keys)) if (k in d) d[k] = v;
}
