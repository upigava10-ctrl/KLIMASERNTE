"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmail } from "@/lib/supabase/auth";
import { useBoundStore } from "@/lib/hooks/useBoundStore";

export default function LoginPage() {
  const router = useRouter();
  const setUser = useBoundStore((state) => state.setUser);
  const setAuthStatus = useBoundStore((state) => state.setAuthStatus);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    setAuthStatus("loading");

    try {
      const profile = await signInWithEmail(email, password);
      setUser(profile);
      setAuthStatus("authenticated");

      const next = new URLSearchParams(window.location.search).get("next");
      const destination = next
        ? new URL(next, window.location.origin)
        : new URL("/", window.location.origin);
      const redirectTo =
        destination.origin === window.location.origin
          ? `${destination.pathname}${destination.search}${destination.hash}`
          : "/";

      router.replace(redirectTo);
      router.refresh();
    } catch (caughtError) {
      setUser(null);
      setAuthStatus("unauthenticated");
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to sign in. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7ef] px-4 py-10 text-[#20301f]">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-xl shadow-[#31452b]/10 md:grid-cols-[1fr_1.05fr]">
        <div className="flex flex-col justify-between bg-[#244b35] p-8 text-white sm:p-12">
          <Link className="text-sm font-bold uppercase tracking-[0.18em]" href="/">
            Klimasernte
          </Link>
          <div className="my-12">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-[#c5d9ae]">
              Welcome back
            </p>
            <h1 className="max-w-sm text-4xl font-semibold leading-tight sm:text-5xl">
              Better harvests start here.
            </h1>
            <p className="mt-5 max-w-sm leading-7 text-[#e2eadc]">
              Sign in to continue to your Klimasernte account.
            </p>
          </div>
          <p className="text-sm text-[#d3dfce]">
            Supporting farmers at every scale.
          </p>
        </div>

        <div className="p-8 sm:p-12">
          <h2 className="text-2xl font-semibold">Sign in</h2>
          <p className="mt-2 text-sm text-[#667365]">
            Enter your account details to get started.
          </p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="email">
                Email address
              </label>
              <input
                autoComplete="email"
                className="w-full rounded-xl border border-[#d9e0d4] px-4 py-3 outline-none transition focus:border-[#527c4a] focus:ring-2 focus:ring-[#527c4a]/20"
                id="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="password">
                Password
              </label>
              <input
                autoComplete="current-password"
                className="w-full rounded-xl border border-[#d9e0d4] px-4 py-3 outline-none transition focus:border-[#527c4a] focus:ring-2 focus:ring-[#527c4a]/20"
                id="password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </div>

            <div>
              <p className="text-sm text-[#667365]">
                Farmer accounts are identified by the producer size saved in
                your profile.
              </p>
            </div>

            {error && (
              <p
                className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
                role="alert"
              >
                {error}
              </p>
            )}

            <button
              className="w-full rounded-xl bg-[#315e3e] px-4 py-3 font-semibold text-white transition hover:bg-[#244b35] focus:outline-none focus:ring-2 focus:ring-[#315e3e] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
