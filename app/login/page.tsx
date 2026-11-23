import { Suspense } from "react";
import AuthForm from "./AuthForm";

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="muted">불러오는 중…</p>}>
      <AuthForm />
    </Suspense>
  );
}
