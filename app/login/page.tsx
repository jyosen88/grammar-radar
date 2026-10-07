import { Suspense } from "react";
import { LoginPanel } from "@/components/LoginPanel";

export const metadata = {
  title: "Grammar Radar · 登录",
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">
          加载中…
        </div>
      }
    >
      <LoginPanel />
    </Suspense>
  );
}
