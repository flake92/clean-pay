import { RegisterForm } from "@/components/auth-forms";

export default function RegisterPage() {
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-md content-center px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-700">
        CleanVPN
      </p>
      <h1 className="mt-4 text-3xl font-semibold">Регистрация</h1>
      <div className="mt-8">
        <RegisterForm />
      </div>
      <a className="mt-5 text-sm text-cyan-700" href="/login">
        Уже есть аккаунт
      </a>
    </main>
  );
}
