"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBoundStore } from "@/lib/hooks/useBoundStore";
import { createUser } from "@/lib/supabase/user";

const producerSizes = [
  { value: "small", label: "Small producer" },
  { value: "medium", label: "Medium producer" },
  { value: "big", label: "Big producer" },
] as const;

type ProducerSize = (typeof producerSizes)[number]["value"];

export default function RegisterPage() {
  const router = useRouter();
  const setUser = useBoundStore((state) => state.setUser);
  const setAuthStatus = useBoundStore((state) => state.setAuthStatus);
  const [nombre, setNombre] = useState("");
  const [apellidoP, setApellidoP] = useState("");
  const [apellidoM, setApellidoM] = useState("");
  const [email, setEmail] = useState("");
  const [producerSize, setProducerSize] = useState<ProducerSize>("small");
  const [photourl, setPhotourl] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    setAuthStatus("loading");

    try {
      const user = await createUser({
        nombre,
        apellido_p: apellidoP,
        apellido_m: apellidoM,
        email,
        producerSize,
        photourl,
      });
      setUser(user);
      setAuthStatus("identified");
      router.replace("/");
      router.refresh();
    } catch (caughtError) {
      setUser(null);
      setAuthStatus("unidentified");
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to create your profile. Please try again.",
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
              Join Klimasernte
            </p>
            <h1 className="max-w-sm text-4xl font-semibold leading-tight sm:text-5xl">
              Create your profile.
            </h1>
            <p className="mt-5 max-w-sm leading-7 text-[#e2eadc]">
              No password is stored. This profile-only flow does not verify
              email ownership.
            </p>
          </div>
          <p className="text-sm text-[#d3dfce]">
            Supporting farmers at every scale.
          </p>
        </div>

        <div className="p-8 sm:p-12">
          <h2 className="text-2xl font-semibold">Create a profile</h2>
          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm font-medium">
              First name
              <input
                autoComplete="given-name"
                className="mt-2 w-full rounded-xl border border-[#d9e0d4] px-4 py-3 outline-none focus:border-[#527c4a] focus:ring-2 focus:ring-[#527c4a]/20"
                onChange={(event) => setNombre(event.target.value)}
                required
                value={nombre}
              />
            </label>
            <label className="block text-sm font-medium">
              Paternal surname
              <input
                autoComplete="family-name"
                className="mt-2 w-full rounded-xl border border-[#d9e0d4] px-4 py-3 outline-none focus:border-[#527c4a] focus:ring-2 focus:ring-[#527c4a]/20"
                onChange={(event) => setApellidoP(event.target.value)}
                required
                value={apellidoP}
              />
            </label>
            <label className="block text-sm font-medium">
              Maternal surname
              <input
                className="mt-2 w-full rounded-xl border border-[#d9e0d4] px-4 py-3 outline-none focus:border-[#527c4a] focus:ring-2 focus:ring-[#527c4a]/20"
                onChange={(event) => setApellidoM(event.target.value)}
                required
                value={apellidoM}
              />
            </label>
            <label className="block text-sm font-medium">
              Email address
              <input
                autoComplete="email"
                className="mt-2 w-full rounded-xl border border-[#d9e0d4] px-4 py-3 outline-none focus:border-[#527c4a] focus:ring-2 focus:ring-[#527c4a]/20"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <label className="block text-sm font-medium">
              Producer size
              <select
                className="mt-2 w-full rounded-xl border border-[#d9e0d4] bg-white px-4 py-3 outline-none focus:border-[#527c4a] focus:ring-2 focus:ring-[#527c4a]/20"
                onChange={(event) =>
                  setProducerSize(event.target.value as ProducerSize)
                }
                value={producerSize}
              >
                {producerSizes.map((producer) => (
                  <option key={producer.value} value={producer.value}>
                    {producer.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Photo URL <span className="font-normal text-[#667365]">(optional)</span>
              <input
                className="mt-2 w-full rounded-xl border border-[#d9e0d4] px-4 py-3 outline-none focus:border-[#527c4a] focus:ring-2 focus:ring-[#527c4a]/20"
                onChange={(event) => setPhotourl(event.target.value)}
                type="url"
                value={photourl}
              />
            </label>

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
              {isSubmitting ? "Creating profile..." : "Create profile"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[#667365]">
            Already have a profile?{" "}
            <Link
              className="font-semibold text-[#315e3e] hover:underline"
              href="/auth/login"
            >
              Continue with email
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
