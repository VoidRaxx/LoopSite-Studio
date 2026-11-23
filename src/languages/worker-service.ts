import { analysisLimit } from "./files";
import { editor, MarkerSeverity } from "monaco-editor";

// Coalesce edits per document; at most one snapshot is in flight per worker.
export function registerChecks<T>(
  languages: string[], owner: string, create: () => Worker,
  apply: (model: editor.ITextModel, data: T) => void,
  accepts: (model: editor.ITextModel) => boolean = () => true,
) {
  const queue = new Set<editor.ITextModel>();
  let worker: Worker | undefined;
  let active: editor.ITextModel | undefined;
  let version = 0;
  let timeout: number;
  function finish(failed: boolean, result?: T) {
    window.clearTimeout(timeout);
    const model = active;
    active = undefined;
    if (failed) { worker?.terminate(); worker = undefined; }
    if (model && !model.isDisposed() && model.getVersionId() === version && languages.includes(model.getLanguageId())) {
      if (failed) editor.setModelMarkers(model, owner, [{ severity: MarkerSeverity.Warning,
        message: "Live-Prüfung konnte nicht abgeschlossen werden.", startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }]);
      else if (result) apply(model, result);
    }
    next();
  }
  function next() {
    if (active) return;
    const model = queue.values().next().value;
    if (!model) return;
    queue.delete(model);
    active = model;
    version = model.getVersionId();
    try {
      if (!worker) {
        const instance = create();
        worker = instance;
        instance.onmessage = e => { if (worker === instance) finish(!!e.data.failed, e.data); };
        instance.onerror = () => { if (worker === instance) finish(true); };
      }
      timeout = window.setTimeout(() => finish(true), 6000);
      worker.postMessage({ language: model.getLanguageId(), uri: model.uri.toString(),
        modelId: model.id, version, text: model.getValue() });
    } catch { finish(true); }
  }
  function attach(model: editor.ITextModel) {
    let timer: number;
    let supported = false;
    function schedule() {
      window.clearTimeout(timer);
      queue.delete(model);
      if (!languages.includes(model.getLanguageId()) || model.getValueLength() > analysisLimit || !accepts(model)) {
        if (supported) editor.setModelMarkers(model, owner, []);
        supported = false;
        return;
      }
      supported = true;
      timer = window.setTimeout(() => { queue.add(model); next(); }, 350);
    }
    const edits = model.onDidChangeContent(schedule);
    const lang = model.onDidChangeLanguage(schedule);
    model.onWillDispose(() => { window.clearTimeout(timer); queue.delete(model); edits.dispose(); lang.dispose(); });
    schedule();
  }
  editor.onDidCreateModel(attach);
}
