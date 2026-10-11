"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { WorkspacePanel } from "./workspace-panel";

type Challenge = { id: string; purpose: "email" | "password"; stage: "current-email" | "new-email"; email: string; resendAt: number };
type Result = { error?: string; message?: string; challenge?: Challenge; user?: { name: string; email: string } };

export function AccountSettings({ name: initialName, email: initialEmail }: { name: string; email: string }) {
  const router = useRouter(), id = useId();
  const revision = useRef(0);
  const [name, setName] = useState(initialName), [email, setEmail] = useState(initialEmail);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null), [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!challenge) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [challenge]);
  const seconds = challenge ? Math.max(0, Math.ceil((challenge.resendAt - now) / 1000)) : 0;
  async function submit(body: Record<string, unknown>) {
    const currentRevision = revision.current;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result: Result = await response.json();
      if (currentRevision !== revision.current) {
        if (result.challenge) void fetch("/api/account", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel-change", challengeId: result.challenge.id }) }).catch(() => {});
        if (result.user) router.refresh();
        return;
      }
      if (result.challenge) { setChallenge(result.challenge); setNow(Date.now()); setCode(""); }
      if (!response.ok) { setError(result.error || "We couldn't save this change. Please try again."); return; }
      setMessage(result.challenge && body.action !== "resend-code"
        ? `A code has been sent to ${result.challenge.email} and expires in 5 minutes.` : result.message || "");
      if (result.user) {
        setName(result.user.name); setEmail(result.user.email);
        if (body.action !== "update-name") { setChallenge(null); setCode(""); setPassword(""); setConfirmation(""); setNewEmail(""); }
        router.refresh();
      }
      if (body.action === "cancel-change") { setChallenge(null); setCode(""); setPassword(""); setConfirmation(""); }
    } catch { if (currentRevision === revision.current) setError("We couldn't save this change. Please try again."); }
    finally { if (currentRevision === revision.current) setBusy(false); }
  }
  function begin(event: FormEvent, purpose: "email" | "password") {
    event.preventDefault();
    if (purpose === "password" && password !== confirmation) { setError("The passwords do not match."); setMessage(""); return; }
    void submit({ action: "request-code", purpose, ...(purpose === "email" ? { newEmail } : {}) });
  }
  function verify(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    void submit({ action: challenge.purpose === "password" ? "change-password" : challenge.stage === "current-email" ? "verify-current-email" : "confirm-new-email",
      challengeId: challenge.id, code, ...(challenge.purpose === "password" ? { newPassword: password } : {}) });
  }
  const notice = <>{error && <p className="account-error" role="alert">{error}</p>}{message && <p className="workspace-meta" role="status">{message}</p>}</>;
  return <WorkspacePanel label="Manage account" title="Account" onClose={() => {
    revision.current += 1;
    setBusy(false);
    setPassword(""); setConfirmation(""); setCode(""); setError(""); setMessage("");
    setChallenge(null);
    if (challenge) {
      void fetch("/api/account", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel-change", challengeId: challenge.id }) }).catch(() => {});
    }
  }}>
    <div className="account-settings">
      <section>
        <h3>Name</h3>
        <form onSubmit={event => { event.preventDefault(); void submit({ action: "update-name", name }); }}>
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} autoComplete="name" value={name} onChange={event => setName(event.target.value)} maxLength={100} required disabled={busy} />
          <button className="workspace-primary" disabled={busy || name.trim() === initialName} type="submit">Save name</button>
        </form>
      </section>
      <section className="workspace-panel-section">
        <h3>Email</h3><p className="workspace-meta account-current-email">{email}</p>
        {challenge?.purpose !== "email" && <form onSubmit={event => begin(event, "email")}>
          <label htmlFor={`${id}-email`}>New email</label>
          <input id={`${id}-email`} type="email" autoComplete="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} maxLength={254} required disabled={busy || Boolean(challenge)} />
          <button className="workspace-primary" type="submit" disabled={busy || Boolean(challenge)}>Change email</button>
        </form>}
      </section>
      {challenge?.purpose !== "email" && <section className="workspace-panel-section">
        <h3>Password</h3>
        {challenge?.purpose !== "password" && <form onSubmit={event => begin(event, "password")}>
          <label htmlFor={`${id}-password`}>New password</label>
          <input id={`${id}-password`} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} maxLength={128} required disabled={busy} />
          <label htmlFor={`${id}-confirmation`}>Confirm new password</label>
          <input id={`${id}-confirmation`} type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} minLength={8} maxLength={128} required disabled={busy} />
          <button className="workspace-primary" type="submit" disabled={busy}>Change password</button>
        </form>}
      </section>}
      {challenge && <section className="workspace-panel-section account-verification">
        <h3>{challenge.purpose === "password" ? "Change password" : challenge.stage === "current-email" ? "Verify current email" : "Verify new email"}</h3>
        <form onSubmit={verify}>
          <label htmlFor={`${id}-code`}>Verification code</label>
          <input id={`${id}-code`} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} minLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required disabled={busy} />
          {error && <p className="account-error" role="alert">{error}</p>}
          {(!error || message) && <p className="workspace-meta" role="status">{message || `A code has been sent to ${challenge.email} and expires in 5 minutes.`}</p>}
          <button className="workspace-primary" disabled={busy || code.length !== 6} type="submit">{busy ? "Please wait…" : challenge.purpose === "password" ? "Verify and change password" : challenge.stage === "current-email" ? "Verify current email" : "Verify and change email"}</button>
        </form>
        <div className="workspace-record-actions">
          <button className="account-text-button" disabled={busy || seconds > 0} type="button" onClick={() => void submit({ action: "resend-code", challengeId: challenge.id })}>{seconds > 0 ? `Resend code in ${seconds}s` : "Resend code"}</button>
          <button className="account-text-button" disabled={busy} type="button" onClick={() => void submit({ action: "cancel-change", challengeId: challenge.id })}>Cancel</button>
        </div>
      </section>}
      {!challenge && notice}
    </div>
  </WorkspacePanel>;
}
