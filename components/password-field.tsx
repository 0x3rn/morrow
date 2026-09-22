"use client";

import { ChangeEvent, useState } from "react";
import styles from "./auth-shell.module.css";

type PasswordFieldProps = {
  autoComplete: string;
  id: string;
  minLength?: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  value: string;
};

export function PasswordField({
  autoComplete,
  id,
  minLength,
  onChange,
  placeholder,
  value,
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className={styles.passwordControl}>
      <input
        id={id}
        type={isVisible ? "text" : "password"}
        value={value}
        onChange={onChange}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        placeholder={placeholder}
      />
      <button
        aria-label={isVisible ? "Hide password" : "Show password"}
        aria-pressed={isVisible}
        className={styles.passwordToggle}
        onClick={() => setIsVisible((visible) => !visible)}
        type="button"
      >
        {isVisible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
