"use client";

import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/user-facing-error";
import { PasswordField } from "./password-field";
import styles from "./auth-shell.module.css";

type Step = "credentials" | "email-verification" | "two-factor";
const errorMessage = getAuthErrorMessage;

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("credentials");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const isRegister = mode === "register";

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timeout = window.setTimeout(() => setResendSeconds((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timeout);
  }, [resendSeconds]);

  async function sendCode(verificationStep: Step, isResend = false) {
    const result = verificationStep === "two-factor"
      ? await authClient.twoFactor.sendOtp({ trustDevice: false })
      : await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "email-verification" });
    if (result.error) {
      setError(errorMessage(result.error));
      return;
    }
    setCode("");
    setNotice(isResend ? "A new code has been sent." : "");
    setResendSeconds(60);
  }

  async function handleCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsLoading(true);
    try {
      if (isRegister) {
        const result = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
        if (result.error) {
          // Creation may succeed before delivery fails; allow resending without re-registering.
          if (result.error.code === "EMAIL_DELIVERY_UNAVAILABLE") {
            setStep("email-verification");
          }
          setError(errorMessage(result.error));
          return;
        }
        setStep("email-verification");
        setResendSeconds(60);
        return;
      }

      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          setStep("email-verification");
          await sendCode("email-verification");
        } else {
          setError(errorMessage(result.error));
        }
        return;
      }
      setPassword("");
      if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
        setStep("two-factor");
        await sendCode("two-factor");
        return;
      }
      // Fail closed if the server isn't configured to require the second factor.
      await authClient.signOut();
      setError("Email verification isn't available. Please try again shortly.");
    } catch {
      setError("We couldn't reach Morrow. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsLoading(true);
    try {
      if (step === "email-verification") {
        const result = await authClient.$fetch<{ token: string | null }>("/email-otp/verify-email", {
          method: "POST",
          body: { email: email.trim(), otp: code, password },
        });
        if (result.error) {
          setError(errorMessage(result.error, true));
          return;
        }
        if (!result.data?.token) {
          setError("We couldn't complete your login. Please try again.");
          return;
        }
      } else {
        const result = await authClient.twoFactor.verifyOtp({ code, trustDevice: false });
        if (result.error) {
          setError(errorMessage(result.error, true));
          return;
        }
      }
      setPassword("");
      // Load the dashboard with the new session cookie rather than a cached
      // unauthenticated router response from before verification.
      window.location.replace("/dashboard");
    } catch {
      setError("We couldn't reach Morrow. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function resendCode() {
    setError("");
    setNotice("");
    setIsLoading(true);
    try {
      await sendCode(step, true);
    } catch {
      setError("We couldn't send your code. Please try again shortly.");
    } finally {
      setIsLoading(false);
    }
  }

  function restart() {
    setCode("");
    setPassword("");
    setError("");
    setNotice("");
    setResendSeconds(0);
    setStep("credentials");
  }

  if (step !== "credentials") {
    return (
      <form key="verification" className={styles.form} onSubmit={handleVerification}>
        <p id="code-message" className={styles.verificationNotice} role="status">
          {notice || "A code has been sent to your email and expires in 5 minutes."}
        </p>
        <div className={styles.field}>
          <label htmlFor="verification-code">Verification code</label>
          <input key="one-time-code" id="verification-code" name="verification-code" type="text" inputMode="numeric" autoComplete="one-time-code"
            className={styles.codeInput} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus disabled={isLoading}
            spellCheck={false} autoCapitalize="none" autoCorrect="off"
            aria-describedby="code-message" placeholder="000000" />
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.submit} type="submit" disabled={isLoading || code.length !== 6}>
          {isLoading ? "Please wait…" : "Verify and continue"}
        </button>
        <div className={styles.verificationActions}>
          <button className={styles.textButton} type="button" onClick={resendCode} disabled={isLoading || resendSeconds > 0}>
            {resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : "Resend code"}
          </button>
          <button className={styles.textButton} type="button" onClick={restart} disabled={isLoading}>Go back</button>
        </div>
      </form>
    );
  }

  return (
    <form key="credentials" className={styles.form} onSubmit={handleCredentials}>
      {isRegister && <div className={styles.field}>
        <label htmlFor="name">Name</label>
        <input id="name" type="text" value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" placeholder="Your name" disabled={isLoading} />
      </div>}
      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@company.com" disabled={isLoading} />
      </div>
      <div className={styles.field}>
        <label htmlFor="password">Password</label>
        <PasswordField id="password" minLength={isRegister ? 8 : undefined} value={password} onChange={(event) => setPassword(event.target.value)}
          autoComplete={isRegister ? "new-password" : "current-password"} placeholder={isRegister ? "Create a password" : "Enter your password"} disabled={isLoading} />
        {isRegister && <p className={styles.fieldHint}>At least 8 characters.</p>}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button className={styles.submit} type="submit" disabled={isLoading}>
        {isLoading ? "Please wait…" : isRegister ? "Create account" : "Continue"}
      </button>
    </form>
  );
}
