"use client";

import { useEffect, useState } from "react";
import { useAdminContext } from "../../lib/admin-context";
import { User } from "../../lib/admin-data";

export default function SettingsPage() {
  const { fetchJson } = useAdminContext();
  const [users, setUsers] = useState<User[]>([]);
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "user" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const usersData = await fetchJson("/users");
      setUsers(usersData.users || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreateUser = async () => {
    setError(null);
    try {
      await fetchJson("/users", {
        method: "POST",
        body: JSON.stringify(newUser),
      });
      setNewUser({ username: "", password: "", role: "user" });
      await loadUsers();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-slate-900/70 p-6 shadow-xl ring-1 ring-white/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Settings</h2>
            <p className="mt-1 text-sm text-slate-300">
              Manage platform access and administrator roles.
            </p>
          </div>
          <button
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200"
            onClick={loadUsers}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200">
            {error}
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white">Users</h3>
            {users.length === 0 ? (
              <p className="text-sm text-slate-300">No users created yet.</p>
            ) : (
              users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/40 p-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{user.username}</p>
                    <p className="text-xs text-slate-400">Role: {user.role}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white">Add user</h3>
            <input
              className="w-full rounded-xl border border-slate-700 bg-white px-4 py-2 text-sm"
              placeholder="Username"
              value={newUser.username}
              onChange={(event) => setNewUser({ ...newUser, username: event.target.value })}
            />
            <input
              className="w-full rounded-xl border border-slate-700 bg-white px-4 py-2 text-sm"
              placeholder="Password"
              type="password"
              value={newUser.password}
              onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
            />
            <select
              className="w-full rounded-xl border border-slate-700 bg-white px-4 py-2 text-sm"
              value={newUser.role}
              onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <button
              className="w-full rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white"
              onClick={handleCreateUser}
            >
              Add user
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
