import { Annotation } from '@codemirror/state';
import { t } from './i18n.js';
import { app, $, nativeHandler } from './app.js';

// Every save gets a revision; the native side answers with saveResult(ok,
// error, revision). Only the newest revision updates the footer.
let saveRevision = 0;
const saveCallbacks = new Map();
// Automation publishes the final snapshot explicitly after updating the stored note.
export const deferAutoSave = Annotation.define();

export const latestRevision = () => saveRevision;

export function persist(force = false, onResult = null) {
  const revision = ++saveRevision, json = JSON.stringify(app.state);
  if (onResult) saveCallbacks.set(revision, onResult);
  if (nativeHandler()) nativeHandler().postMessage({ type: 'save', json, revision, force });
  else { try { localStorage.setItem('inkflit-test', json); saveResult(true, null, revision); } catch (error) { saveResult(false, error.message, revision); } }
}

export function saveResult(ok, error, revision) {
  const callback = saveCallbacks.get(revision);
  if (callback) { saveCallbacks.delete(revision); callback(ok, revision); }
  if (Number.isInteger(revision) && revision < saveRevision) return;
  const message = ok ? '' : (error || t('error.saveFailed'));
  $('save').textContent = message; $('save').title = message; $('save').className = ok ? '' : 'error';
}

// Resolves after a forced save, or rejects with a message for automation callers.
export const persistNow = () => new Promise((resolve, reject) => persist(true, ok => ok ? resolve() : reject(new Error('Save failed; changes remain in the editor'))));

export const snapshotForFlush = () => app.state ? { json: JSON.stringify(app.state), revision: saveRevision } : null;
