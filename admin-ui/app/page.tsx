"use client";

import { useEffect, useMemo, useState } from "react";

type Instance = {
  id: string;
  name?: string;
  image: string;
  status: string;
  serviceName: string;
  namespace: string;
  containerPort: number;
};

type AllowedImage = {
  id: number;
  name: string;
  dockerHubUrl: string;
  defaultPort: number;
  description: string;
};

type User = {
  id: number;
  username: string;
  role: string;
};

const tokenKey = "radome.token";

const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3000";

const fetchJson = async (path: string, options: RequestInit = {}) => {
  const token = localStorage.getItem(tokenKey);
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
};

const classNames = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loginState, setLoginState] = useState({ username: "", password: "" });
  const [instances, setInstances] = useState<Instance[]>([]);
  const [images, setImages] = useState<AllowedImage[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [newInstance, setNewInstance] = useState({ image: "", name: "", containerPort: "" });
  const [newImage, setNewImage] = useState({
    name: "",
    dockerHubUrl: "",
    defaultPort: "",
    description: "",
  });
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "user" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isLoggedIn = useMemo(() => Boolean(token), [token]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [instancesData, imagesData, usersData] = await Promise.all([
        fetchJson("/instances"),
        fetchJson("/images"),
        fetchJson("/users"),
      ]);
      setInstances(instancesData.instances || []);
      setImages(imagesData.allowed || []);
      setUsers(usersData.users || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem(tokenKey);
    if (stored) {
      setToken(stored);
    }
  }, []);

  useEffect(() => {
    if (token) {
      loadData();
    }
  }, [token]);

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

  const handleCreateInstance = async () => {
    setError(null);
    const payload: Record<string, string | number> = {
      image: newInstance.image,
    };
    if (newInstance.name) {
      payload.name = newInstance.name;
    }
    if (newInstance.containerPort) {
      payload.containerPort = Number(newInstance.containerPort);
    }
    try {
      await fetchJson("/instances", { method: "POST", body: JSON.stringify(payload) });
      setNewInstance({ image: "", name: "", containerPort: "" });
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleStopInstance = async (id: string) => {
    setError(null);
    try {
      await fetchJson(`/instances/${id}`, { method: "DELETE" });
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreateImage = async () => {
    setError(null);
    try {
      await fetchJson("/images", {
        method: "POST",
        body: JSON.stringify({
          name: newImage.name,
          dockerHubUrl: newImage.dockerHubUrl,
          defaultPort: Number(newImage.defaultPort),
          description: newImage.description,
        }),
      });
      setNewImage({ name: "", dockerHubUrl: "", defaultPort: "", description: "" });
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleUpdateImage = async (image: AllowedImage) => {
    const name = prompt("Image name", image.name);
    if (!name) return;
    const dockerHubUrl = prompt("DockerHub URL", image.dockerHubUrl);
    if (!dockerHubUrl) return;
    const defaultPortInput = prompt("Default port", image.defaultPort.toString());
    const defaultPort = Number(defaultPortInput);
    if (!Number.isFinite(defaultPort)) {
      setError("Invalid port");
      return;
    }
    const description = prompt("Description", image.description);
    if (!description) return;

    setError(null);
    try {
      await fetchJson(`/images/${image.id}`, {
        method: "PUT",
        body: JSON.stringify({ name, dockerHubUrl, defaultPort, description }),
      });
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDeleteImage = async (id: number) => {
    setError(null);
    try {
      await fetchJson(`/images/${id}`, { method: "DELETE" });
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreateUser = async () => {
    setError(null);
    try {
      await fetchJson("/users", {
        method: "POST",
        body: JSON.stringify(newUser),
      });
      setNewUser({ username: "", password: "", role: "user" });
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
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
    <div className="px-6 py-10 lg:px-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-white">Radome Admin Control Panel</h1>
          <p className="mt-2 text-sm text-slate-300">
            Manage Kubernetes-backed agent instances and the allowed image catalog.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loading && <span className="text-sm text-slate-400">Refreshing...</span>}
          <button
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200"
            onClick={loadData}
          >
            Refresh
          </button>
          <button
            className="rounded-xl bg-slate-800 px-4 py-2 text-sm text-slate-200"
            onClick={handleLogout}
          >
            Log out
          </button>
        </div>
      </header>

      {error && (
        <div className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200">
          {error}
        </div>
      )}

      <section className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-3xl bg-slate-900/70 p-6 shadow-xl ring-1 ring-white/10">
          <h2 className="text-lg font-semibold text-white">Instances</h2>
          <div className="mt-4 space-y-4">
            {instances.length === 0 ? (
              <p className="text-sm text-slate-300">No instances running yet.</p>
            ) : (
              instances.map((instance) => (
                <div
                  key={instance.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {instance.name || instance.id}
                    </p>
                    <p className="text-xs text-slate-400">Image: {instance.image}</p>
                    <p className="text-xs text-slate-400">Service: {instance.serviceName}</p>
                    <p className="text-xs text-slate-400">
                      Namespace: {instance.namespace} · Port {instance.containerPort}
                    </p>
                  </div>
                  <button
                    className="rounded-xl border border-rose-400/40 px-4 py-2 text-xs text-rose-200"
                    onClick={() => handleStopInstance(instance.id)}
                  >
                    Stop instance
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl bg-slate-900/70 p-6 shadow-xl ring-1 ring-white/10">
          <h2 className="text-lg font-semibold text-white">Launch new instance</h2>
          <div className="mt-4 space-y-3">
            <input
              className="w-full rounded-xl border border-slate-700 bg-white px-4 py-2 text-sm"
              placeholder="Image name"
              value={newInstance.image}
              onChange={(event) => setNewInstance({ ...newInstance, image: event.target.value })}
            />
            <input
              className="w-full rounded-xl border border-slate-700 bg-white px-4 py-2 text-sm"
              placeholder="Friendly name"
              value={newInstance.name}
              onChange={(event) => setNewInstance({ ...newInstance, name: event.target.value })}
            />
            <input
              className="w-full rounded-xl border border-slate-700 bg-white px-4 py-2 text-sm"
              placeholder="Container port"
              value={newInstance.containerPort}
              onChange={(event) =>
                setNewInstance({ ...newInstance, containerPort: event.target.value })
              }
            />
            <button
              className="w-full rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white"
              onClick={handleCreateInstance}
            >
              Launch instance
            </button>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-3xl bg-slate-900/70 p-6 shadow-xl ring-1 ring-white/10">
          <h2 className="text-lg font-semibold text-white">Allowed images</h2>
          <div className="mt-4 space-y-4">
            {images.length === 0 ? (
              <p className="text-sm text-slate-300">No images configured.</p>
            ) : (
              images.map((image) => (
                <div
                  key={image.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{image.name}</p>
                    <p className="text-xs text-slate-400">{image.description}</p>
                    <p className="text-xs text-slate-400">Default port: {image.defaultPort}</p>
                    <a
                      className="text-xs text-sky-300"
                      href={image.dockerHubUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      DockerHub link
                    </a>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200"
                      onClick={() => handleUpdateImage(image)}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-xl border border-rose-400/40 px-3 py-2 text-xs text-rose-200"
                      onClick={() => handleDeleteImage(image.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl bg-slate-900/70 p-6 shadow-xl ring-1 ring-white/10">
          <h2 className="text-lg font-semibold text-white">Add allowed image</h2>
          <div className="mt-4 space-y-3">
            <input
              className="w-full rounded-xl border border-slate-700 bg-white px-4 py-2 text-sm"
              placeholder="Image name"
              value={newImage.name}
              onChange={(event) => setNewImage({ ...newImage, name: event.target.value })}
            />
            <input
              className="w-full rounded-xl border border-slate-700 bg-white px-4 py-2 text-sm"
              placeholder="DockerHub URL"
              value={newImage.dockerHubUrl}
              onChange={(event) => setNewImage({ ...newImage, dockerHubUrl: event.target.value })}
            />
            <input
              className="w-full rounded-xl border border-slate-700 bg-white px-4 py-2 text-sm"
              placeholder="Default port"
              value={newImage.defaultPort}
              onChange={(event) => setNewImage({ ...newImage, defaultPort: event.target.value })}
            />
            <input
              className="w-full rounded-xl border border-slate-700 bg-white px-4 py-2 text-sm"
              placeholder="Description"
              value={newImage.description}
              onChange={(event) => setNewImage({ ...newImage, description: event.target.value })}
            />
            <button
              className="w-full rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white"
              onClick={handleCreateImage}
            >
              Add image
            </button>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-3xl bg-slate-900/70 p-6 shadow-xl ring-1 ring-white/10">
        <h2 className="text-lg font-semibold text-white">Users</h2>
        <div className="mt-4 grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-3">
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

      <footer className="mt-10 text-xs text-slate-500">
        API base: {apiBase}
      </footer>
    </div>
  );
}
