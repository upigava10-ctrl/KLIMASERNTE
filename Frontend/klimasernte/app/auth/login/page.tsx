"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBoundStore } from "@/lib/hooks/useBoundStore";
import { getUserByEmail } from "@/lib/supabase/user";

export default function LoginPage() {
  const router = useRouter();
  const setUser = useBoundStore((state) => state.setUser);
  const setAuthStatus = useBoundStore((state) => state.setAuthStatus);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    setAuthStatus("loading");

    try {
      const profile = await getUserByEmail(email);
      setUser(profile);
      setAuthStatus("identified");

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
      setAuthStatus("unidentified");
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
              Find your profile
            </p>
            <h1 className="max-w-sm text-4xl font-semibold leading-tight sm:text-5xl">
              Better harvests start here.
            </h1>
            <p className="mt-5 max-w-sm leading-7 text-[#e2eadc]">
              Continue to your Klimasernte profile.
            </p>
          </div>
          <p className="text-sm text-[#d3dfce]">
            Supporting farmers at every scale.
          </p>
        </div>

        <div className="p-8 sm:p-12">
          <h2 className="text-2xl font-semibold">Find your profile</h2>
          <p className="mt-2 text-sm text-[#667365]">
            Enter your email to load your profile. This does not verify that you
            own the email address.
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
              <p className="text-sm text-[#667365]">
                Enter the email address saved in your profile. This profile-only
                lookup does not verify email ownership.
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
              {isSubmitting ? "Loading profile..." : "Continue"}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-[#667365]">
            New to Klimasernte?{" "}
            <Link
              className="font-semibold text-[#315e3e] hover:underline"
              href="/auth/register"
            >
              Create a profile
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
