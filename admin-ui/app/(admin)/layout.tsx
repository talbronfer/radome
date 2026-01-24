"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminContext } from "../lib/admin-context";
import { apiBase, proxyBase, tokenKey } from "../lib/admin-data";

const classNames = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const navItems = [
  { label: "Overview", href: "/" },
  { label: "Instances", href: "/instances" },
  { label: "Images", href: "/images" },
  { label: "Settings", href: "/settings" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [loginState, setLoginState] = useState({ username: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();

  const isLoggedIn = useMemo(() => Boolean(token), [token]);

  const fetchJson = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      } as Record<string, string>;

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`${apiBase}${path}`, { ...options, headers });
      if (response.status === 204) {
        return null;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }
      return data;
    },
    [token],
  );

  useEffect(() => {
    const stored = localStorage.getItem(tokenKey);
    if (stored) {
      setToken(stored);
    }
  }, []);

  const handleLogin = async () => {
    setError(null);
    try {
      const data = await fetchJson("/auth/login", {
        method: "POST",
        body: JSON.stringify(loginState),
      });
      localStorage.setItem(tokenKey, data.token);
      setToken(data.token);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleLogout = async () => {
    try {
      await fetchJson("/auth/logout", { method: "POST" });
    } catch (err) {
      console.warn(err);
    }
    localStorage.removeItem(tokenKey);
    setToken(null);
  };

  if (!isLoggedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md rounded-3xl bg-slate-900/70 p-8 shadow-2xl ring-1 ring-white/10">
          <h1 className="text-2xl font-semibold text-white">Radome Admin</h1>
          <p className="mt-2 text-sm text-slate-300">
            Sign in with your admin credentials to manage agent instances.
          </p>
          <div className="mt-6 space-y-4">
            <input
              className="w-full rounded-xl border border-slate-700 bg-white px-4 py-3 text-sm"
              placeholder="Username"
              value={loginState.username}
              onChange={(event) => setLoginState({ ...loginState, username: event.target.value })}
            />
            <input
              className="w-full rounded-xl border border-slate-700 bg-white px-4 py-3 text-sm"
              placeholder="Password"
              type="password"
              value={loginState.password}
              onChange={(event) => setLoginState({ ...loginState, password: event.target.value })}
            />
            {error && <p className="text-sm text-rose-300">{error}</p>}
            <button
              className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white"
              onClick={handleLogin}
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AdminContext.Provider value={{ token, setToken, apiBase, proxyBase, fetchJson }}>
      <div className="px-6 py-10 lg:px-12">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-white">Radome Admin Control Panel</h1>
            <p className="mt-2 text-sm text-slate-300">
              Manage Kubernetes-backed agent instances and the allowed image catalog.
            </p>
          </div>
          <button
            className="rounded-xl bg-slate-800 px-4 py-2 text-sm text-slate-200"
            onClick={handleLogout}
          >
            Log out
          </button>
        </header>

        <nav className="mt-6 flex flex-wrap gap-3 text-sm">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={classNames(
                  "rounded-full border px-4 py-2 transition",
                  isActive
                    ? "border-sky-400/60 bg-sky-500/10 text-sky-100"
                    : "border-slate-800 text-slate-300 hover:border-slate-600 hover:text-white",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6">{children}</div>

        <footer className="mt-10 text-xs text-slate-500">API base: {apiBase}</footer>
      </div>
    </AdminContext.Provider>
  );
}
