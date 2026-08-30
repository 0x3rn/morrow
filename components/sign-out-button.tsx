"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();

    router.push("/sign-in");
    router.refresh();
  }

  return (
    <button type="button" onClick={handleSignOut}>
      Sign out
    </button>
  );
}