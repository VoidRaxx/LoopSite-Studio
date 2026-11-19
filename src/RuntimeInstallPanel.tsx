import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Component = "php" | "caddy";
type Plan = {
  component: string;
  manager: string;
  command: string;
  description: string;
  available: boolean;
  installed: boolean;
  requiresPrivilege: boolean;
};
type InstallResult = { installed: boolean; logPath: string; details: string };
type Props = { onInstalled: () => void };

const COMPONENTS: { id: Component; title: string; purpose: string }[] = [
  { id: "php", title: "PHP", purpose: "Lokale PHP-Websites und PHP-Router ausführen." },
  { id: "caddy", title: "Caddy", purpose: "Mehrere lokale Domains auf deine Server weiterleiten." },
];

export default function RuntimeInstallPanel({ onInstalled }: Props) {
  const [plans, setPlans] = useState<Partial<Record<Component, Plan>>>({});
  const [busy, setBusy] = useState<Component | null>(null);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<Partial<Record<Component, string>>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all(COMPONENTS.map(c =>
        invoke<Plan>("runtime_install_plan", { component: c.id })));
      setPlans({ php: results[0], caddy: results[1] });
      setError("");
    } catch (err) {
      setError("Komponentenstatus konnte nicht gelesen werden: " + String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function install(component: Component) {
    if (busy) return;
    const plan = plans[component];
    if (!plan?.available || plan.installed) return;
    const question = [
      "Komponente systemweit über den Paketmanager installieren?",
      "",
      COMPONENTS.find(c => c.id === component)?.title ?? component,
      "Paketmanager: " + plan.manager,
      "Auszuführender Befehl: " + plan.command,
      plan.requiresPrivilege ? "Es wird eine Systemberechtigung über Polkit angefordert." : "",
      "",
      "LoopSite führt keine eigenen Dienst-Startbefehle aus. Der System-Paketmanager kann allerdings Abhängigkeiten installieren und Dienste automatisch starten (z. B. Caddy unter Debian/Ubuntu).",
      "Mit der Installation fortfahren?",
    ].filter(Boolean).join("\n");
    if (!window.confirm(question)) return;

    setBusy(component);
    setError("");
    setMessages(prev => ({ ...prev, [component]: "Installation läuft …" }));
    try {
      const result = await invoke<InstallResult>("install_runtime", { component });
      setMessages(prev => ({ ...prev, [component]: result.details + " Protokoll: " + result.logPath }));
      if (result.installed) onInstalled();
      await refresh();
    } catch (err) {
      setError("Installation von " + component.toUpperCase() + " fehlgeschlagen: " + String(err));
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return <section className="setup-panel">
    <div className="page-heading">
      <div><p className="eyebrow">EINRICHTUNG</p><h1>Komponenten installieren</h1>
        <p>PHP und Caddy ohne komplizierte Terminalbefehle einrichten.</p></div>
      <button className="secondary" disabled={loading || busy !== null} onClick={() => void refresh()}>
        Erneut prüfen
      </button>
    </div>
    {error && <div className="notice error" role="alert">{error}
      <button onClick={() => setError("")} aria-label="Fehlermeldung schließen">×</button></div>}
    <div className="setup-grid">
      {COMPONENTS.map(component => {
        const plan = plans[component.id];
        return <article className="card settings" key={component.id}>
          <div className="setup-top">
            <div><h2>{component.title}</h2><p>{component.purpose}</p></div>
            <span className="status">{!plan || loading ? "Prüfung …" : plan.installed ? "Erkannt" :
              plan.available ? "Nicht installiert" : "Manuell erforderlich"}</span>
          </div>
          <p>{plan?.description ?? "Installationsmöglichkeiten werden geprüft."}</p>
          {plan && <div className="setup-command">
            <strong>Paketmanager: {plan.manager}</strong>
            {plan.command && <code>{plan.command}</code>}
            {plan.requiresPrivilege && <small>Administratorberechtigung erforderlich</small>}
          </div>}
          <button className="primary" disabled={loading || busy !== null || !plan?.available || plan.installed}
            onClick={() => void install(component.id)}>
            {busy === component.id ? "Installiere …" :
              plan?.installed ? "Bereits vorhanden" : plan?.available ? "Jetzt installieren" : "Installation nicht verfügbar"}
          </button>
          {messages[component.id] && <p className="setup-message" role="status">{messages[component.id]}</p>}
        </article>;
      })}
    </div>
    <p className="hint">Die Installation erfolgt nur nach deiner Bestätigung über den Paketmanager des Betriebssystems.
      Es werden keine Installationsskripte aus dem Internet ausgeführt. Für Windows wird die aktuelle Patchversion
      der unterstützten PHP-8.5-Reihe verwendet; unter Linux bestimmt das Repository deiner Distribution die Version.
      Bestehende Projekte bleiben unverändert. Bei einem geänderten PATH kann ein Neustart von LoopSite notwendig sein.</p>
  </section>;
}
