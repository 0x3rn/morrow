"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth-shell";
import { PasswordField } from "@/components/password-field";
import styles from "@/components/auth-shell.module.css";

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
      setError("We couldn't create your account with those details.");
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
          <PasswordField
            id="password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="Create a password"
          />
          <p className={styles.fieldHint}>At least 8 characters.</p>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            <span>{error}</span>
          </p>
        )}
        <button className={styles.submit} type="submit" disabled={isLoading}>
          {isLoading ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}
