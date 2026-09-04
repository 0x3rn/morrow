"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();

    router.push("/login");
    router.refresh();
  }

  return (
    <button className="morrow-signout" type="button" onClick={handleSignOut}>
      Sign out
    </button>
  );
}
