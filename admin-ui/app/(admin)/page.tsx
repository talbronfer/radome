"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdminContext } from "../lib/admin-context";

export default function AdminOverviewPage() {
  const { fetchJson } = useAdminContext();
  const [counts, setCounts] = useState({ instances: 0, images: 0, users: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadCounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const [instancesData, imagesData, usersData] = await Promise.all([
        fetchJson("/instances"),
        fetchJson("/images"),
        fetchJson("/users"),
      ]);
      setCounts({
        instances: instancesData.instances?.length ?? 0,
        images: imagesData.allowed?.length ?? 0,
        users: usersData.users?.length ?? 0,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCounts();
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-slate-900/70 p-6 shadow-xl ring-1 ring-white/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Overview</h2>
            <p className="mt-1 text-sm text-slate-300">
              Jump into the most common admin workflows from here.
            </p>
          </div>
          <button
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200"
            onClick={loadCounts}
          >
            {loading ? "Refreshing..." : "Refresh counts"}
          </button>
        </div>
        {error && (
          <p className="mt-4 text-sm text-rose-300">{error}</p>
        )}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { label: "Running instances", value: counts.instances },
            { label: "Allowed images", value: counts.images },
            { label: "Users", value: counts.users },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"
            >
              <p className="text-xs uppercase tracking-wide text-slate-400">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold text-white">{card.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Link
          className="rounded-3xl border border-slate-800 bg-slate-950/40 p-5 text-sm text-slate-200 hover:border-slate-600"
          href="/instances"
        >
          <h3 className="text-base font-semibold text-white">Instances</h3>
          <p className="mt-2 text-sm text-slate-300">
            Launch, stop, and copy proxy URLs for running agents.
          </p>
        </Link>
        <Link
          className="rounded-3xl border border-slate-800 bg-slate-950/40 p-5 text-sm text-slate-200 hover:border-slate-600"
          href="/images"
        >
          <h3 className="text-base font-semibold text-white">Images</h3>
          <p className="mt-2 text-sm text-slate-300">
            Manage the allowed image catalog and environment defaults.
          </p>
        </Link>
        <Link
          className="rounded-3xl border border-slate-800 bg-slate-950/40 p-5 text-sm text-slate-200 hover:border-slate-600"
          href="/settings"
        >
          <h3 className="text-base font-semibold text-white">Settings</h3>
          <p className="mt-2 text-sm text-slate-300">
            Add administrators and review user roles.
          </p>
        </Link>
      </section>
    </div>
  );
}
