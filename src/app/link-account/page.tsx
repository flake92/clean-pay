import { LinkAccountPanel } from "@/components/link-account-panel";

export default function LinkAccountPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-700">
        CleanVPN
      </p>
      <h1 className="mt-4 text-3xl font-semibold">Привязка аккаунта</h1>
      <section className="mt-8 border border-zinc-200 bg-white p-6">
        <LinkAccountPanel />
      </section>
    </main>
  );
}
