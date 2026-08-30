import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <main>
      <h1>Morrow Dashboard</h1>

      <p>Welcome, {session.user.name}</p>
      <p>{session.user.email}</p>

      <SignOutButton />
    </main>
  );
}