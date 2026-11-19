import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { useCallback, useEffect, useRef, useState } from "react";

const RELEASE_API = "https://api.github.com/repos/VoidRaxx/LoopSite-Studio/releases?per_page=30";
const RELEASE_PAGE = "https://github.com/VoidRaxx/LoopSite-Studio/releases";
const SKIPPED_KEY = "loopsite-updates-skipped-version";

type ReleaseKind = "security" | "feature";
type Release = {
  version: string;
  tag: string;
  experimental: boolean;
  title: string;
  notes: string;
  date: string | null;
  kind: ReleaseKind;
};

type Props = {
  checkSignal: number;
  editorDirty: boolean;
  runningServers: number;
  onStatus: (message: string) => void;
  includeExperimental: boolean;
  installedExperimental: boolean;
};

export function parseVersion(version: string): [number,number,number,number | null] | null {
  const result=/^v?(\d+)\.(\d+)\.(\d+)(?:-experimental\.(\d+))?$/i.exec(version.trim());
  if (!result) return null;
  const parts=result.slice(1,4).map(Number);
  const pre=result[4] === undefined ? null : Number(result[4]);
  if([...parts,...(pre===null?[]:[pre])].some(x=>!Number.isSafeInteger(x)))return null;
  return [parts[0],parts[1],parts[2],pre];
}
export function compareVersions(left: string,right: string): number {
  const a=parseVersion(left),b=parseVersion(right);
  if(!a||!b)return 0;
  for(let i=0;i<3;i++){const x=a[i] as number;const y=b[i] as number;if(x!==y)return x-y;}
  if(a[3]===null)return b[3]===null?0:1;
  if(b[3]===null)return -1;
  return a[3]-b[3];
}
export function newerVersion(candidate:string,installed:string):boolean {
  if(!parseVersion(candidate)||!parseVersion(installed))return false;
  return compareVersions(candidate,installed)>0;
}

function releaseKind(body: string): ReleaseKind {
  // Only an explicit, maintainer-authored marker classifies a security release.
  // Do not classify by guessing from unrelated text in release notes.
  return /<!--\s*loopsite-update:security\s*-->/i.test(body) ? "security" : "feature";
}

function releaseNotes(body: string): string {
  const cleaned = body.replace(/<!--\s*loopsite-update:(?:security|feature)\s*-->/gi, "").trim();
  return cleaned.slice(0, 12000) || "No changelog provided for this update.";
}

export default function UpdateManager({checkSignal, editorDirty, runningServers, onStatus, includeExperimental, installedExperimental}: Props) {
  const [release, setRelease] = useState<Release | null>(null);
  const [installedVersion, setInstalledVersion] = useState("");
  const [signedUpdater, setSignedUpdater] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const checkUpdates = useCallback(async (manual: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setError("");
    if (manual) onStatus("Checking for updates…");
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
      if (!response.ok) throw new Error("GitHub Releases responded with HTTP " + response.status);
      const items: unknown = await response.json();
      if (!Array.isArray(items)) throw new Error("Invalid release list.");
      const candidates = items.filter((item): item is Record<string,unknown> =>
        typeof item==="object" && item!==null &&
        typeof (item as Record<string,unknown>).tag_name==="string" &&
        (item as Record<string,unknown>).draft!==true
      ).filter(item => {
        const tag = item.tag_name as string;
        const experimental = /-experimental\.\d+$/i.test(tag);
        return (!experimental || includeExperimental || installedExperimental) &&
          item.prerelease===experimental &&
          newerVersion(tag,currentVersion);
      }).sort((a,b)=>compareVersions(b.tag_name as string,a.tag_name as string));
      if(candidates.length===0){
        setRelease(null);setDialogVisible(false);
        onStatus("LoopSite Studio is up to date (v" + currentVersion + ").");
        return;
      }
      const item=candidates[0];
      const tag=item.tag_name as string;
      const version=tag.replace(/^v/i,"");
      const body=typeof item.body==="string"?item.body:"";
      const found:Release={
        version,tag,experimental: /-experimental\.\d+$/i.test(tag),
        title:typeof item.name==="string" && item.name.length>0
          ?item.name.slice(0,120):"LoopSite Studio "+version,
        notes:releaseNotes(body),
        date:typeof item.published_at==="string"?item.published_at:null,
        kind:releaseKind(body),
      };
      setRelease(found);
      onStatus("Update " + version + " available" +
        (found.kind === "security" ? " (security update)." : "."));
      const skipped = localStorage.getItem(SKIPPED_KEY);
      if (manual || skipped !== version) setDialogVisible(true);
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err);
      setError("Update check failed: " + details);
      if (manual) setDialogVisible(true);
      onStatus("Update check failed. Check your internet connection.");
    } finally {
      pending.current = false;
    }
  }, [onStatus,includeExperimental,installedExperimental]);

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
    onStatus("Version " + release.version + " skipped. Newer versions will still be offered.");
    setDialogVisible(false);
    setError("");
  }

  async function install() {
    if (!release || busy || editorDirty) return;
    setBusy(true);setError("");
    try {
      if (!signedUpdater) {
        await openUrl(RELEASE_PAGE + "/tag/" + encodeURIComponent(release.tag));
        setDialogVisible(false);
        onStatus("Official release page opened. Signed in-app installation is not available in this build.");
        return;
      }
      // The native updater restricts the URL to our repository and verifies
      // the public-key signature and the exact version shown in the dialog.
      await invoke("install_signed_release",{version:release.version,tag:release.tag});
      onStatus("Update installed. LoopSite Studio will restart.");
      await relaunch();
    } catch (err) {
      setError("Could not install update: " +
        (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  if (!dialogVisible) return null;
  return <div className="overlay" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="update-title" className="modal update-modal">
      {release ? <>
        <header className="update-header">
          <div>
            <p className="eyebrow">LOOPSITE STUDIO · UPDATE</p>
            <h2 id="update-title">{release.title}</h2>
            <p>{release.experimental ? "Experimental Release" : "Stable Release"}</p>
            <p className="update-versions">v{installedVersion} → v{release.version}
              {release.date && " · " + new Date(release.date).toLocaleDateString("en-US")}</p>
          </div>
          <span className={"update-kind " + (release.kind === "security" ? "security" : "feature")}>
            {release.kind === "security" ? "Security Update" : "Feature Update"}
          </span>
        </header>
        <div className="update-notes">
          <h3>Changenotes</h3>
          <pre>{release.notes}</pre>
        </div>
        {release.kind === "security" &&
          <p className="update-security-hint">This release addresses security issues. We recommend installing it promptly. You can still choose Later or Skip Update.</p>}
        {editorDirty && <p className="update-warning">You have unsaved editor changes. Save them before installing so no work is lost.</p>}
        {runningServers > 0 &&
          <p className="update-warning">{runningServers} local servers are running. They will stop when the application restarts.</p>}
        {!signedUpdater && <p className="update-warning">This installation cannot self-update. The Update button opens the official release page for manual installation.</p>}
        {error && <p role="alert" className="update-error">{error}</p>}
        <footer className="modal-actions update-actions">
          <button className="subtle" type="button" onClick={skip} disabled={busy}>Skip Update</button>
          <button className="secondary" type="button" onClick={later} disabled={busy}>Later</button>
          <button className="primary" type="button" disabled={busy || editorDirty} onClick={() => void install()}>
            {busy ? "Installing…" : signedUpdater ? "Update" : "Download Update"}
          </button>
        </footer>
      </> : <>
        <h2 id="update-title">Update Check</h2>
        <p className="update-error">{error || "No update was found."}</p>
        <div className="modal-actions">
          <button className="secondary" onClick={later}>Close</button>
        </div>
      </>}
    </section>
  </div>;
}
