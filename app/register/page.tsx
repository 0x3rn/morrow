"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthShell, SubmitArrow } from "@/components/auth-shell";
import styles from "@/components/auth-shell.module.css";

function ErrorIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6.5v4.5M10 14h.01" />
    </svg>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    const { error } = await authClient.signUp.email({ name, email, password });
    setIsLoading(false);

    if (error) {
      setError(error.message || "Unable to create account.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <AuthShell mode="register">
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label htmlFor="name">Name</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoComplete="name"
            placeholder="Your name"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
            placeholder="you@company.com"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Create a secure password"
          />
          <p className={styles.fieldHint}>Use at least 8 characters.</p>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            <ErrorIcon />
            <span>{error}</span>
          </p>
        )}
        <button className={styles.submit} type="submit" disabled={isLoading}>
          <span>{isLoading ? "Creating workspace..." : "Create workspace"}</span>
          <SubmitArrow />
        </button>
      </form>
    </AuthShell>
  );
}
