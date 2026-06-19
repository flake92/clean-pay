import { TariffsPanel } from "@/components/tariffs-panel";

export default function TariffsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-700">
        CleanVPN
      </p>
      <h1 className="mt-4 text-3xl font-semibold">Тарифы</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
        Доступные тарифы, длительности и способы оплаты загружаются из
        Remnashop через BFF. Выберите подходящий набор перед оплатой.
      </p>
      <section className="mt-8">
        <TariffsPanel />
      </section>
    </main>
  );
}
