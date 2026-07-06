"use client";

import { useState } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";

const safetyCards = [
  {
    label: "System state",
    value: "Paused",
    detail: "The deployment is live, but autonomous work is held in standby.",
    tone: "amber"
  },
  {
    label: "External contact",
    value: "Off",
    detail: "No calls, emails, or texts go out without explicit owner approval.",
    tone: "blue"
  },
  {
    label: "Owner approval",
    value: "Required",
    detail: "Outside-contact decisions stay gated until you deliberately open them.",
    tone: "green"
  }
] as const;

const verification = [
  "Production page is online",
  "Build and automated tests passed",
  "Database functions are locked down",
  "Runtime error scan came back clean"
];

const workflow = [
  { step: "1", title: "Detect", copy: "Watch protected routes, task queues, and webhook signals." },
  { step: "2", title: "Prepare", copy: "Draft the next action while policy checks run in the background." },
  { step: "3", title: "Ask", copy: "Pause for approval whenever the action could contact someone outside Robur." },
  { step: "4", title: "Execute", copy: "Proceed only after the safety gate is deliberately opened." }
];

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.09,
      delayChildren: 0.08
    }
  }
};

const rise: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] }
  }
};

export function AnimatedHome() {
  const reduceMotion = useReducedMotion();
  const [showRouteDetails, setShowRouteDetails] = useState(false);
  const initial = false;
  const animate = reduceMotion ? undefined : "show";

  return (
    <main className="app-shell">
      <motion.section className="status-bar" initial={initial} animate={animate} variants={container}>
        <motion.div className="brand-lockup" variants={rise}>
          <span className="status-dot" aria-hidden="true" />
          <span>Robur Remed</span>
        </motion.div>
        <motion.div className="safe-mode" variants={rise}>
          Safe review mode
        </motion.div>
      </motion.section>

      <motion.section className="hero-panel" initial={initial} animate={animate} variants={container}>
        <motion.div className="hero-copy" variants={rise}>
          <p className="eyebrow">Production deployment</p>
          <h1>Autonomous operations, held behind your approval.</h1>
          <p className="lede">
            The worker is live on Vercel and ready for review. Its most important job right now is restraint:
            outside contact stays blocked until you decide to activate it.
          </p>
        </motion.div>

        <motion.div className="control-panel" variants={rise}>
          <div className="control-panel-header">
            <span>Current mode</span>
            <strong>Protected</strong>
          </div>
          <div className="control-visual" aria-hidden="true">
            <motion.span
              className="control-ring"
              animate={reduceMotion ? undefined : { rotate: 360 }}
              transition={{ duration: 22, ease: "linear", repeat: Infinity }}
            />
            <span className="control-core">On</span>
          </div>
          <p>Safety gates are active. Automation can prepare work, but it cannot contact people outside Robur.</p>
          <button
            aria-expanded={showRouteDetails}
            className="route-toggle"
            type="button"
            onClick={() => setShowRouteDetails((value) => !value)}
          >
            {showRouteDetails ? "Hide route details" : "Show route details"}
          </button>
          {showRouteDetails ? (
            <motion.div
              className="route-details"
              initial={reduceMotion ? false : { opacity: 0, height: 0 }}
              animate={reduceMotion ? undefined : { opacity: 1, height: "auto" }}
              exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
            >
              <span>Protected status route, token required</span>
              <code>/api/admin/status</code>
            </motion.div>
          ) : null}
          <a className="console-link" href="/console">
            Open secure console
          </a>
        </motion.div>
      </motion.section>

      <motion.section
        className="safety-grid"
        initial={initial}
        animate={animate}
        variants={container}
        aria-label="Safety status"
      >
        {safetyCards.map((card) => (
          <motion.article className={`safety-card ${card.tone}`} key={card.label} variants={rise}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.detail}</p>
          </motion.article>
        ))}
      </motion.section>

      <motion.section className="operations-band" initial={initial} animate={animate} variants={container}>
        <motion.div className="verification-panel" variants={rise}>
          <h2>Verified before handoff</h2>
          <ul>
            {verification.map((item) => (
              <li key={item}>
                <span aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div className="workflow-panel" variants={rise}>
          <h2>Approval path</h2>
          <div className="workflow-list">
            {workflow.map((item) => (
              <div className="workflow-item" key={item.step}>
                <span>{item.step}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.copy}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </motion.section>
    </main>
  );
}
