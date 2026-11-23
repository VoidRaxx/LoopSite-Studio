import { useEffect, useState } from "react";
import { editor, MarkerSeverity, Uri } from "monaco-editor";

import { translate, type Language } from "./i18n";

export default function EditorProblems({ language, uri, jump }: { language: Language; uri: string; jump: (line: number, column: number) => void }) {
  const [markers, setMarkers] = useState<editor.IMarker[]>([]);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const resource = Uri.parse(uri);
    const update = () => setMarkers(editor.getModelMarkers({ resource }).filter(m => m.severity >= MarkerSeverity.Warning));
    update();
    const listener = editor.onDidChangeMarkers(changed => {
      if (changed.some(item => item.toString() === uri)) update();
    });
    return () => listener.dispose();
  }, [uri]);
  return <aside className="editor-problems">
    <button className="problem-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> {translate(language, "problems")} <strong>{markers.length}</strong>
    </button>
    {expanded && <div className="problem-list">
      {markers.length === 0 && <p>{translate(language, "noProblems")}</p>}
      {markers.slice(0, 100).map((marker, i) => <button key={i} onClick={() => jump(marker.startLineNumber, marker.startColumn)}>
        <span>{translate(language, marker.severity === MarkerSeverity.Error ? "errorLabel" : "warningLabel")} · {marker.startLineNumber}:{marker.startColumn}</span>
        {marker.message}
      </button>)}
    </div>}
  </aside>;
}
