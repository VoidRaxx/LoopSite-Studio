import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

const RELEASE_API = "https://api.github.com/repos/VoidRaxx/LoopSite-Studio/releases/latest";
const RELEASE_PAGE = "https://github.com/VoidRaxx/LoopSite-Studio/releases/latest";
const SKIPPED_KEY = "loopsite-updates-skipped-version";

type ReleaseKind = "security" | "feature";
type Release = {
  version: string;
  title: string;
  notes: string;
  date: string | null;
  kind: ReleaseKind;
};
type Transfer = { received: number; total: number | null };

type Props = {
  checkSignal: number;
  editorDirty: boolean;
  runningServers: number;
  onStatus: (message: string) => void;
};

export function parseVersion(version: string): [number, number, number] | null {
  const result = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][a-z0-9.-]+)?$/i.exec(version.trim());
  if (!result) return null;
  const numbers = result.slice(1, 4).map(Number);
  if (numbers.some(value => !Number.isSafeInteger(value))) return null;
  return numbers as [number, number, number];
}

export function newerVersion(candidate: string, installed: string): boolean {
  const next = parseVersion(candidate);
  const current = parseVersion(installed);
  if (!next || !current) return false;
  return next.some((value, index) =>
    value > current[index] && next.slice(0, index).every((prior, i) => prior === current[i]));
}

function releaseKind(body: string): ReleaseKind {
  // Only an explicit, maintainer-authored marker classifies a security release.
  // Do not classify by guessing from unrelated text in release notes.
  return /<!--\s*loopsite-update:security\s*-->/i.test(body) ? "security" : "feature";
}

function releaseNotes(body: string): string {
  const cleaned = body.replace(/<!--\s*loopsite-update:(?:security|feature)\s*-->/gi, "").trim();
  return cleaned.slice(0, 12000) || "Für dieses Update wurden noch keine Changenotes hinterlegt.";
}

export default function UpdateManager({checkSignal, editorDirty, runningServers, onStatus}: Props) {
  const [release, setRelease] = useState<Release | null>(null);
  const [installedVersion, setInstalledVersion] = useState("");
  const [signedUpdater, setSignedUpdater] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const checkUpdates = useCallback(async (manual: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setError("");
    if (manual) onStatus("Updateprüfung läuft …");
    try {
      const currentVersion = await getVersion();
      setInstalledVersion(currentVersion);
      const ready = await invoke<boolean>("update_install_ready").catch(() => false);
      setSignedUpdater(ready);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 12000);
      let response: Response;
      try {
        response = await fetch(RELEASE_API, {
          headers: { Accept: "application/vnd.github+json" },
          cache: "no-store",
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeout);
      }
      // A new repository may not have published its first release yet.
      if (response.status === 404) {
        setRelease(null);setDialogVisible(false);
        onStatus("Noch kein veröffentlichter Release verfügbar.");
        return;
      }
      if (!response.ok) throw new Error("GitHub-Releases antwortet mit HTTP " + response.status);
      const data: unknown = await response.json();
      if (!data || typeof data !== "object") throw new Error("Ungültige Release-Daten.");
      const item = data as Record<string, unknown>;
      if (typeof item.tag_name !== "string" ||
          (typeof item.body !== "string" && item.body !== null) ||
          item.draft === true || item.prerelease === true) {
        throw new Error("Ungültiger oder nicht veröffentlichter Release.");
      }
      if (!newerVersion(item.tag_name, currentVersion)) {
        setRelease(null);setDialogVisible(false);
        onStatus("LoopSite Studio ist aktuell (v" + currentVersion + ").");
        return;
      }
      const version = item.tag_name.replace(/^v/i, "");
      const body = typeof item.body === "string" ? item.body : "";
      const found: Release = {
        version,
        title: typeof item.name === "string" && item.name.length > 0
          ? item.name.slice(0, 120) : "LoopSite Studio " + version,
        notes: releaseNotes(body),
        date: typeof item.published_at === "string" ? item.published_at : null,
        kind: releaseKind(body),
      };
      setRelease(found);
      onStatus("Update " + version + " verfügbar" +
        (found.kind === "security" ? " (Sicherheitsupdate)." : "."));
      const skipped = localStorage.getItem(SKIPPED_KEY);
      if (manual || skipped !== version) setDialogVisible(true);
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err);
      setError("Updateprüfung fehlgeschlagen: " + details);
      if (manual) setDialogVisible(true);
      onStatus("Updateprüfung fehlgeschlagen. Internetverbindung prüfen.");
    } finally {
      pending.current = false;
    }
  }, [onStatus]);

  // Startup check, nonblocking: project loading and local servers do not wait for GitHub.
  useEffect(() => {
    if (!import.meta.env.DEV) void checkUpdates(false);
  }, [checkUpdates]);
  useEffect(() => {
    if (checkSignal > 0) void checkUpdates(true);
  }, [checkSignal, checkUpdates]);

  function later() {
    if (busy) return;
    setDialogVisible(false);
    setError("");
  }
  function skip() {
    if (busy || !release) return;
    // Skip exactly this release; a subsequent higher version is shown normally.
    localStorage.setItem(SKIPPED_KEY, release.version);
    onStatus("Version " + release.version + " übersprungen. Neue Versionen werden weiter geprüft.");
    setDialogVisible(false);
    setError("");
  }

  async function install() {
    if (!release || busy || editorDirty) return;
    setBusy(true);setError("");setTransfer(null);
    try {
      if (!signedUpdater) {
        // Unsigned experimental CI artifacts cannot be silently installed.
        // Users can still inspect the official published GitHub Release.
        await openUrl(RELEASE_PAGE);
        setDialogVisible(false);
        onStatus("Release-Seite geöffnet. Für direkte Installation sind signierte Updates erforderlich.");
        return;
      }
      const update = await check({ timeout: 20000 });
      // Only install the same release whose changes were shown to the user.
      if (!update || update.version.replace(/^v/i, "") !== release.version) {
        throw new Error("Das signierte Update stimmt nicht mit dem angezeigten Release überein. Bitte erneut prüfen.");
      }
      let received = 0;
      let total: number | null = null;
      await update.downloadAndInstall(event => {
        if (event.event === "Started") {
          received = 0;
          total = typeof event.data.contentLength === "number" ? event.data.contentLength : null;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
        }
        setTransfer({received,total});
      });
      onStatus("Update installiert. LoopSite Studio wird neu gestartet.");
      await relaunch();
    } catch (err) {
      setError("Update konnte nicht installiert werden: " +
        (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  if (!dialogVisible) return null;
  const percent = transfer?.total && transfer.total > 0
    ? Math.min(100,Math.round(transfer.received * 100 / transfer.total)) : null;
  return <div className="overlay" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="update-title" className="modal update-modal">
      {release ? <>
        <header className="update-header">
          <div>
            <p className="eyebrow">LOOPSITE STUDIO · UPDATE</p>
            <h2 id="update-title">{release.title}</h2>
            <p className="update-versions">v{installedVersion} → v{release.version}
              {release.date && " · " + new Date(release.date).toLocaleDateString("de-DE")}</p>
          </div>
          <span className={"update-kind " + (release.kind === "security" ? "security" : "feature")}>
            {release.kind === "security" ? "Sicherheitsupdate" : "Feature-Update"}
          </span>
        </header>
        <div className="update-notes">
          <h3>Changenotes</h3>
          <pre>{release.notes}</pre>
        </div>
        {release.kind === "security" &&
          <p className="update-security-hint">Dieses Release ist als Sicherheitsupdate gekennzeichnet.
            Die zeitnahe Installation wird empfohlen. Du kannst es dennoch später installieren oder überspringen.</p>}
        {editorDirty && <p className="update-warning">Du hast ungespeicherte Editor-Änderungen.
          Speichere diese vor der Installation, damit keine Arbeit verloren geht.</p>}
        {runningServers > 0 &&
          <p className="update-warning">{runningServers} lokale Server laufen noch.
            Beim Neustart der Anwendung werden sie beendet.</p>}
        {!signedUpdater && <p className="update-warning">Diese experimentelle App-Version hat noch
          keinen signierten In-App-Updater. „Update“ öffnet deshalb die offizielle Release-Seite,
          auf der du den Installer manuell herunterladen kannst.</p>}
        {transfer && <div className="update-progress" role="status">
          <span>Update wird heruntergeladen {percent !== null ? "· " + percent + " %" : "…"}</span>
          {percent !== null && <progress value={percent} max={100}/>}
        </div>}
        {error && <p role="alert" className="update-error">{error}</p>}
        <footer className="modal-actions update-actions">
          <button className="subtle" type="button" onClick={skip} disabled={busy}>Skip Update</button>
          <button className="secondary" type="button" onClick={later} disabled={busy}>Later</button>
          <button className="primary" type="button" disabled={busy || editorDirty} onClick={() => void install()}>
            {busy ? "Installiere …" : signedUpdater ? "Update" : "Update herunterladen"}
          </button>
        </footer>
      </> : <>
        <h2 id="update-title">Updateprüfung</h2>
        <p className="update-error">{error || "Es konnte kein Update gefunden werden."}</p>
        <div className="modal-actions">
          <button className="secondary" onClick={later}>Schließen</button>
        </div>
      </>}
    </section>
  </div>;
}
