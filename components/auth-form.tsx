"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { PasswordField } from "./password-field";
import styles from "./auth-shell.module.css";

type Step = "credentials" | "email-verification" | "two-factor" | "verified";
type AuthError = { code?: string; status?: number; message?: string };

function errorMessage(error: AuthError, verifying = false) {
  if (error.code === "ACCOUNT_TEMPORARILY_LOCKED") return "Too many incorrect codes. Please try logging in again in 15 minutes.";
  if (error.status === 429) return "Too many requests. Please wait a minute before trying again.";
  if (error.code === "EMAIL_DELIVERY_UNAVAILABLE") return "We couldn't send your code. Please try again shortly.";
  if (error.code?.includes("TOO_MANY_ATTEMPTS")) return "Too many incorrect codes. Request a new code and try again.";
  if (error.code === "INVALID_TWO_FACTOR_COOKIE") return "Your login attempt expired. Go back and enter your password again.";
  if (verifying) return "That code is incorrect or has expired. Try again or request a new code.";
  return "We couldn't continue with those details. Please check them and try again.";
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
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

  async function sendCode(verificationStep: Step) {
    const result = verificationStep === "two-factor"
      ? await authClient.twoFactor.sendOtp({ trustDevice: false })
      : await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "email-verification" });
    if (result.error) {
      setError(errorMessage(result.error));
      return;
    }
    setCode("");
    setNotice("A new code has been sent. Use the latest email.");
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
            setPassword("");
            setStep("email-verification");
          }
          setError(errorMessage(result.error));
          return;
        }
        setPassword("");
        setStep("email-verification");
        setResendSeconds(60);
        return;
      }

      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          setPassword("");
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
        const result = await authClient.emailOtp.verifyEmail({ email: email.trim(), otp: code });
        if (result.error) {
          setError(errorMessage(result.error, true));
          return;
        }
        setCode("");
        setStep("verified");
      } else {
        const result = await authClient.twoFactor.verifyOtp({ code, trustDevice: false });
        if (result.error) {
          setError(errorMessage(result.error, true));
          return;
        }
        router.replace("/dashboard");
        router.refresh();
      }
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
      await sendCode(step);
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
    setStep("credentials");
  }

  if (step === "verified") {
    return (
      <div className={styles.form}>
        <p className={styles.verificationNotice} role="status">Your email is verified. Log in with your password and an email code to open your workspace.</p>
        {isRegister
          ? <Link className={styles.submitLink} href="/login">Continue to login</Link>
          : <button className={styles.submit} onClick={restart}>Continue to login</button>}
      </div>
    );
  }

  if (step !== "credentials") {
    return (
      <form className={styles.form} onSubmit={handleVerification}>
        <p className={styles.verificationNotice}>Enter the six-digit code sent to <strong>{email.trim()}</strong> {step === "two-factor" ? "to finish logging in." : "to verify your email."}</p>
        <div className={styles.field}>
          <label htmlFor="verification-code">Verification code</label>
          <input id="verification-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code"
            className={styles.codeInput} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus disabled={isLoading}
            aria-describedby="code-hint" placeholder="000000" />
          <p id="code-hint" className={styles.fieldHint}>Codes expire after 5 minutes. Use the most recent code.</p>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <p className={styles.fieldHint} role="status">{notice}</p>}
        <button className={styles.submit} type="submit" disabled={isLoading || code.length !== 6}>
          {isLoading ? "Please wait…" : step === "two-factor" ? "Verify and log in" : "Verify email"}
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
    <form className={styles.form} onSubmit={handleCredentials}>
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
      <p className={styles.fieldHint}>We&apos;ll email you a six-digit code {isRegister ? "to verify your account" : "to complete login"}.</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button className={styles.submit} type="submit" disabled={isLoading}>
        {isLoading ? "Please wait…" : isRegister ? "Create account" : "Continue"}
      </button>
    </form>
  );
}
