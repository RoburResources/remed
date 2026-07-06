"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

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

type SessionPayload = {
  ok: boolean;
  authenticated: boolean;
};

type ConsoleState = "checking" | "locked" | "ready";

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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function ConsoleClient() {
  const [state, setState] = useState<ConsoleState>("checking");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const openTaskCount = useMemo(
    () => tasks.filter((task) => ["pending", "in_progress", "awaiting_approval"].includes(task.status)).length,
    [tasks]
  );

  async function refreshConsole() {
    setError(null);
    const [statusData, tasksData] = await Promise.all([
      readJson<StatusPayload>("/api/admin/status"),
      readJson<TasksPayload>("/api/admin/tasks?limit=25")
    ]);

    setStatus(statusData);
    setTasks(tasksData.tasks ?? []);
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
    await readJson<{ ok: boolean }>("/api/admin/session", { method: "DELETE" }).catch(() => undefined);
    setStatus(null);
    setTasks([]);
    setState("locked");
    setIsBusy(false);
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
