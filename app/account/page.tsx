import { Suspense } from "react";
import AccountView from "./AccountView";

export default function AccountPage() {
  return (
    <Suspense fallback={<p className="muted">불러오는 중…</p>}>
      <AccountView />
    </Suspense>
  );
}
