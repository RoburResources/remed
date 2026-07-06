"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { RetellWebClient as RetellWebClientInstance } from "retell-client-js-sdk";

type DailyMetrics = {
  tasks_generated?: number;
  tasks_completed?: number;
  tasks_failed?: number;
  calls_made?: number;
  emails_sent?: number;
  sms_sent?: number;
  api_spend_cents?: number;
};

type StatusPayload = {
  ok: boolean;
  system_status: string;
  kill_switch_active: boolean;
  external_contact_enabled: boolean;
  external_contact_requires_owner_approval: boolean;
  daily_metrics?: DailyMetrics;
  task_counts?: Record<string, number>;
  recent_opportunities?: Array<{
    id: number;
    title?: string | null;
    agency?: string | null;
    closing_date?: string | null;
    estimated_value?: number | null;
  }>;
};

type Task = {
  id: number;
  source: string;
  description: string;
  priority_score: number;
  status: string;
  action_type: string;
  external_contact: boolean;
  approval_required: boolean;
  created_at: string;
};

type TasksPayload = {
  ok: boolean;
  tasks: Task[];
};

type SettingsPayload = {
  ok: boolean;
  voice: {
    retell_configured: boolean;
    retell_web_call_configured: boolean;
    retell_briefings_enabled: boolean;
    owner_phone_configured: boolean;
    owner_email_configured: boolean;
    owner_contact_rule: string;
  };
  limits: {
    max_calls_per_day: number;
    max_sms_per_day: number;
    max_emails_per_day: number;
    max_api_spend_cents_per_day: number;
  };
  bounds: SettingsPayload["limits"];
};

type SettingsDraft = {
  retell_briefings_enabled: boolean;
  max_calls_per_day: string;
  max_sms_per_day: string;
  max_emails_per_day: string;
  max_api_spend_cents_per_day: string;
};

type SessionPayload = {
  ok: boolean;
  authenticated: boolean;
};

type ConsoleState = "checking" | "locked" | "ready";
type BrowserVoiceState = "idle" | "starting" | "active" | "agent-speaking" | "ended" | "error";

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw Object.assign(new Error(data.error ?? "Request failed"), { status: response.status });
  }

  return data;
}

function metricValue(metrics: DailyMetrics | undefined, key: keyof DailyMetrics): number {
  return Number(metrics?.[key] ?? 0);
}

function draftFromSettings(settings: SettingsPayload): SettingsDraft {
  return {
    retell_briefings_enabled: settings.voice.retell_briefings_enabled,
    max_calls_per_day: String(settings.limits.max_calls_per_day),
    max_sms_per_day: String(settings.limits.max_sms_per_day),
    max_emails_per_day: String(settings.limits.max_emails_per_day),
    max_api_spend_cents_per_day: String(settings.limits.max_api_spend_cents_per_day)
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function browserVoiceLabel(state: BrowserVoiceState): string {
  switch (state) {
    case "starting":
      return "Starting";
    case "active":
      return "Live";
    case "agent-speaking":
      return "Agent speaking";
    case "ended":
      return "Ended";
    case "error":
      return "Needs attention";
    case "idle":
    default:
      return "Idle";
  }
}

export function ConsoleClient() {
  const retellClientRef = useRef<RetellWebClientInstance | null>(null);
  const [state, setState] = useState<ConsoleState>("checking");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [browserVoiceState, setBrowserVoiceState] = useState<BrowserVoiceState>("idle");
  const [browserVoiceCallId, setBrowserVoiceCallId] = useState<string | null>(null);
  const [browserVoiceMuted, setBrowserVoiceMuted] = useState(false);
  const [browserVoiceNote, setBrowserVoiceNote] = useState("Browser voice is idle.");

  const openTaskCount = useMemo(
    () => tasks.filter((task) => ["pending", "in_progress", "awaiting_approval"].includes(task.status)).length,
    [tasks]
  );

  async function refreshConsole() {
    setError(null);
    const [statusData, tasksData, settingsData] = await Promise.all([
      readJson<StatusPayload>("/api/admin/status"),
      readJson<TasksPayload>("/api/admin/tasks?limit=25"),
      readJson<SettingsPayload>("/api/admin/settings")
    ]);

    setStatus(statusData);
    setTasks(tasksData.tasks ?? []);
    setSettings(settingsData);
    setSettingsDraft(draftFromSettings(settingsData));
    setState("ready");
  }

  useEffect(() => {
    readJson<SessionPayload>("/api/admin/session")
      .then((session) => {
        if (session.authenticated) {
          return refreshConsole();
        }

        setState("locked");
        return undefined;
      })
      .catch((err: Error) => {
        setState("locked");
        setError(err.message);
      });
  }, []);

  useEffect(() => {
    return () => {
      retellClientRef.current?.stopCall();
      retellClientRef.current = null;
    };
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);

    try {
      await readJson<{ ok: boolean }>("/api/admin/session", {
        method: "POST",
        body: JSON.stringify({ token })
      });
      setToken("");
      await refreshConsole();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to unlock console");
      setState("locked");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLogout() {
    setIsBusy(true);
    retellClientRef.current?.stopCall();
    retellClientRef.current = null;
    setBrowserVoiceState("idle");
    setBrowserVoiceCallId(null);
    setBrowserVoiceMuted(false);
    setBrowserVoiceNote("Browser voice is idle.");
    await readJson<{ ok: boolean }>("/api/admin/session", { method: "DELETE" }).catch(() => undefined);
    setStatus(null);
    setSettings(null);
    setSettingsDraft(null);
    setTasks([]);
    setActionMessage(null);
    setState("locked");
    setIsBusy(false);
  }

  async function handleBrowserVoiceStart() {
    if (retellClientRef.current) return;

    setIsBusy(true);
    setError(null);
    setActionMessage(null);
    setBrowserVoiceState("starting");
    setBrowserVoiceNote("Opening secure voice session.");

    try {
      const result = await readJson<{ ok: boolean; call_id: string; access_token: string }>("/api/admin/voice/web-call", {
        method: "POST",
        body: JSON.stringify({ confirmOwnerWebCall: true })
      });
      const { RetellWebClient } = await import("retell-client-js-sdk");
      const client = new RetellWebClient();
      retellClientRef.current = client;
      setBrowserVoiceCallId(result.call_id);

      client.on("call_started", () => {
        setBrowserVoiceState("active");
        setBrowserVoiceNote("Voice connected.");
        setActionMessage("Browser voice started.");
      });
      client.on("call_ready", () => {
        setBrowserVoiceState((current) => (current === "agent-speaking" ? current : "active"));
        setBrowserVoiceNote("Voice ready.");
      });
      client.on("agent_start_talking", () => {
        setBrowserVoiceState("agent-speaking");
        setBrowserVoiceNote("Agent is speaking.");
      });
      client.on("agent_stop_talking", () => {
        setBrowserVoiceState("active");
        setBrowserVoiceNote("Voice connected.");
      });
      client.on("call_ended", () => {
        retellClientRef.current = null;
        setBrowserVoiceState("ended");
        setBrowserVoiceMuted(false);
        setBrowserVoiceNote("Browser voice ended.");
      });
      client.on("error", (event: unknown) => {
        retellClientRef.current = null;
        setBrowserVoiceState("error");
        setBrowserVoiceMuted(false);
        setBrowserVoiceNote("Browser voice could not start.");
        setError(typeof event === "string" ? event : "Browser voice failed");
      });

      await client.startCall({ accessToken: result.access_token });
      await client.startAudioPlayback().catch(() => undefined);
    } catch (err) {
      retellClientRef.current?.stopCall();
      retellClientRef.current = null;
      setBrowserVoiceState("error");
      setBrowserVoiceCallId(null);
      setBrowserVoiceMuted(false);
      setBrowserVoiceNote("Browser voice could not start.");
      setError(err instanceof Error ? err.message : "Browser voice failed");
    } finally {
      setIsBusy(false);
    }
  }

  function handleBrowserVoiceStop() {
    retellClientRef.current?.stopCall();
    retellClientRef.current = null;
    setBrowserVoiceState("ended");
    setBrowserVoiceMuted(false);
    setBrowserVoiceNote("Browser voice ended.");
  }

  function handleBrowserVoiceMuteToggle() {
    const client = retellClientRef.current;
    if (!client) return;

    if (browserVoiceMuted) {
      client.unmute();
      setBrowserVoiceMuted(false);
      setBrowserVoiceNote("Microphone on.");
      return;
    }

    client.mute();
    setBrowserVoiceMuted(true);
    setBrowserVoiceNote("Microphone muted.");
  }

  async function handleVoiceCall(type: "morning" | "evening") {
    setIsBusy(true);
    setError(null);
    setActionMessage(null);

    try {
      const result = await readJson<{ ok: boolean; message: string }>("/api/admin/voice/briefing", {
        method: "POST",
        body: JSON.stringify({ type, confirmOwnerCall: true })
      });
      setActionMessage(result.message);
      await refreshConsole();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice call failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settingsDraft) return;

    setIsBusy(true);
    setError(null);
    setActionMessage(null);

    try {
      const nextSettings = await readJson<SettingsPayload>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({
          retell_briefings_enabled: settingsDraft.retell_briefings_enabled,
          max_calls_per_day: Number(settingsDraft.max_calls_per_day),
          max_sms_per_day: Number(settingsDraft.max_sms_per_day),
          max_emails_per_day: Number(settingsDraft.max_emails_per_day),
          max_api_spend_cents_per_day: Number(settingsDraft.max_api_spend_cents_per_day)
        })
      });
      setSettings(nextSettings);
      setSettingsDraft(draftFromSettings(nextSettings));
      setActionMessage("Settings saved.");
      await refreshConsole();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Settings update failed");
    } finally {
      setIsBusy(false);
    }
  }

  if (state === "checking") {
    return (
      <main className="console-shell">
        <section className="console-login">
          <span className="console-pill">Robur Remed</span>
          <h1>Checking console access</h1>
          <div className="console-loading" aria-label="Loading console" />
        </section>
      </main>
    );
  }

  if (state === "locked") {
    return (
      <main className="console-shell">
        <motion.section
          className="console-login"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <span className="console-pill">Secure console</span>
          <h1>Unlock Robur Remed</h1>
          <p className="console-muted">Enter the dashboard access token to view live operational status.</p>

          <form className="console-form" onSubmit={handleLogin}>
            <label htmlFor="dashboard-token">Dashboard access token</label>
            <input
              id="dashboard-token"
              autoComplete="current-password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste access token"
              type="password"
            />
            <button disabled={isBusy || token.trim().length === 0} type="submit">
              {isBusy ? "Unlocking..." : "Unlock console"}
            </button>
          </form>

          {error ? <p className="console-error">{error}</p> : null}
          <a className="console-back-link" href="/">
            Back to overview
          </a>
        </motion.section>
      </main>
    );
  }

  const metrics = status?.daily_metrics;
  const browserVoiceConfigured = Boolean(settings?.voice.retell_web_call_configured);
  const phoneVoiceConfigured = Boolean(settings?.voice.retell_configured);
  const browserVoiceActive = Boolean(retellClientRef.current);
  const statusCards = [
    {
      label: "System",
      value: status?.system_status ?? "unknown",
      detail: status?.kill_switch_active ? "Paused by kill switch" : "Ready for queued work"
    },
    {
      label: "Outside contact",
      value: status?.external_contact_enabled ? "Enabled" : "Off",
      detail: status?.external_contact_requires_owner_approval ? "Owner approval required" : "Approval gate relaxed"
    },
    {
      label: "Open work",
      value: String(openTaskCount),
      detail: "Pending, active, or awaiting approval"
    }
  ];

  return (
    <main className="console-shell console-shell-wide">
      <section className="console-topbar">
        <div>
          <span className="console-pill">Robur Remed Console</span>
          <h1>Operations status</h1>
        </div>
        <div className="console-actions">
          <button
            disabled={isBusy}
            onClick={() =>
              refreshConsole().catch((err) => setError(err instanceof Error ? err.message : "Refresh failed"))
            }
            type="button"
          >
            Refresh
          </button>
          <button disabled={isBusy} onClick={handleLogout} type="button">
            Lock
          </button>
        </div>
      </section>

      {error ? <p className="console-error">{error}</p> : null}
      {actionMessage ? <p className="console-success">{actionMessage}</p> : null}

      <section className="console-card-grid" aria-label="System status">
        {statusCards.map((card) => (
          <motion.article
            className="console-card"
            key={card.label}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
          >
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.detail}</p>
          </motion.article>
        ))}
      </section>

      <section className="console-split">
        <article className="console-panel">
          <div className="panel-heading">
            <h2>Voice access</h2>
            <span className="task-status">{browserVoiceConfigured ? "Configured" : "Needs config"}</span>
          </div>
          <div className={`voice-session voice-session-${browserVoiceState}`}>
            <div>
              <span>Browser voice</span>
              <strong>{browserVoiceLabel(browserVoiceState)}</strong>
            </div>
            <p>
              {browserVoiceNote}
              {browserVoiceCallId ? <span> Call {browserVoiceCallId}</span> : null}
            </p>
          </div>
          <div className="settings-list">
            <div>
              <span>Browser voice</span>
              <strong>{browserVoiceConfigured ? "Configured" : "Missing"}</strong>
            </div>
            <div>
              <span>Phone calls</span>
              <strong>{phoneVoiceConfigured ? "Configured" : "Missing"}</strong>
            </div>
            <div>
              <span>Owner phone</span>
              <strong>{settings?.voice.owner_phone_configured ? "Set" : "Missing"}</strong>
            </div>
            <div>
              <span>Owner email</span>
              <strong>{settings?.voice.owner_email_configured ? "Set" : "Missing"}</strong>
            </div>
            <div>
              <span>Briefings</span>
              <strong>{settings?.voice.retell_briefings_enabled ? "On" : "Off"}</strong>
            </div>
          </div>
          <div className="console-actions console-actions-wrap">
            <button
              disabled={isBusy || !browserVoiceConfigured || browserVoiceActive}
              onClick={handleBrowserVoiceStart}
              type="button"
            >
              Talk in browser
            </button>
            <button disabled={!browserVoiceActive} onClick={handleBrowserVoiceMuteToggle} type="button">
              {browserVoiceMuted ? "Unmute" : "Mute"}
            </button>
            <button disabled={!browserVoiceActive} onClick={handleBrowserVoiceStop} type="button">
              End voice
            </button>
            <button disabled={isBusy || !phoneVoiceConfigured} onClick={() => handleVoiceCall("morning")} type="button">
              Call morning brief
            </button>
            <button disabled={isBusy || !phoneVoiceConfigured} onClick={() => handleVoiceCall("evening")} type="button">
              Call evening brief
            </button>
          </div>
        </article>

        <article className="console-panel">
          <div className="panel-heading">
            <h2>Settings</h2>
            <span className="task-status">Protected</span>
          </div>
          {settingsDraft ? (
            <form className="settings-form" onSubmit={handleSettingsSubmit}>
              <label className="settings-toggle">
                <input
                  checked={settingsDraft.retell_briefings_enabled}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, retell_briefings_enabled: event.target.checked })
                  }
                  type="checkbox"
                />
                <span>Voice briefings</span>
                <strong>{settingsDraft.retell_briefings_enabled ? "On" : "Off"}</strong>
              </label>
              <label>
                <span>Daily calls</span>
                <input
                  max={settings?.bounds.max_calls_per_day}
                  min={1}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, max_calls_per_day: event.target.value })}
                  type="number"
                  value={settingsDraft.max_calls_per_day}
                />
              </label>
              <label>
                <span>Daily SMS</span>
                <input
                  max={settings?.bounds.max_sms_per_day}
                  min={1}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, max_sms_per_day: event.target.value })}
                  type="number"
                  value={settingsDraft.max_sms_per_day}
                />
              </label>
              <label>
                <span>Daily emails</span>
                <input
                  max={settings?.bounds.max_emails_per_day}
                  min={1}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, max_emails_per_day: event.target.value })}
                  type="number"
                  value={settingsDraft.max_emails_per_day}
                />
              </label>
              <label>
                <span>API spend cents</span>
                <input
                  max={settings?.bounds.max_api_spend_cents_per_day}
                  min={1}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, max_api_spend_cents_per_day: event.target.value })
                  }
                  type="number"
                  value={settingsDraft.max_api_spend_cents_per_day}
                />
              </label>
              <button disabled={isBusy} type="submit">
                Save settings
              </button>
            </form>
          ) : (
            <p className="console-muted">Settings unavailable.</p>
          )}
        </article>
      </section>

      <section className="console-split">
        <article className="console-panel">
          <h2>Today</h2>
          <div className="metric-list">
            <div>
              <span>Tasks generated</span>
              <strong>{metricValue(metrics, "tasks_generated")}</strong>
            </div>
            <div>
              <span>Tasks completed</span>
              <strong>{metricValue(metrics, "tasks_completed")}</strong>
            </div>
            <div>
              <span>Calls</span>
              <strong>{metricValue(metrics, "calls_made")}</strong>
            </div>
            <div>
              <span>Emails</span>
              <strong>{metricValue(metrics, "emails_sent")}</strong>
            </div>
            <div>
              <span>SMS</span>
              <strong>{metricValue(metrics, "sms_sent")}</strong>
            </div>
            <div>
              <span>API spend</span>
              <strong>{metricValue(metrics, "api_spend_cents")}c</strong>
            </div>
          </div>
        </article>

        <article className="console-panel">
          <h2>Task counts</h2>
          <div className="status-counts">
            {Object.entries(status?.task_counts ?? {}).map(([key, value]) => (
              <div key={key}>
                <span>{key.replaceAll("_", " ")}</span>
                <strong>{value}</strong>
              </div>
            ))}
            {Object.keys(status?.task_counts ?? {}).length === 0 ? <p className="console-muted">No tasks yet.</p> : null}
          </div>
        </article>
      </section>

      <section className="console-panel">
        <h2>Recent tasks</h2>
        <div className="task-table">
          {tasks.map((task) => (
            <article className="task-row" key={task.id}>
              <div>
                <strong>{task.description}</strong>
                <span>
                  {task.action_type.replaceAll("_", " ")} · {formatDate(task.created_at)}
                </span>
              </div>
              <div>
                <span className="task-status">{task.status.replaceAll("_", " ")}</span>
                {task.external_contact ? <span className="task-flag">External</span> : null}
                {task.approval_required ? <span className="task-flag">Approval</span> : null}
              </div>
            </article>
          ))}
          {tasks.length === 0 ? <p className="console-muted">No recent tasks returned.</p> : null}
        </div>
      </section>

      <section className="console-panel">
        <h2>Recent opportunities</h2>
        <div className="opportunity-list">
          {(status?.recent_opportunities ?? []).map((opportunity) => (
            <article key={opportunity.id}>
              <strong>{opportunity.title ?? "Untitled opportunity"}</strong>
              <span>{opportunity.agency ?? "Unknown agency"}</span>
            </article>
          ))}
          {(status?.recent_opportunities ?? []).length === 0 ? (
            <p className="console-muted">No recent opportunities returned.</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
