"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminContext } from "../../lib/admin-context";
import { AllowedImage, Instance, buildProxyUrl } from "../../lib/admin-data";

export default function InstancesPage() {
  const { fetchJson, proxyBase } = useAdminContext();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [images, setImages] = useState<AllowedImage[]>([]);
  const [newInstance, setNewInstance] = useState({ image: "", name: "", containerPort: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const selectedImage = useMemo(
    () => images.find((image) => image.name === newInstance.image),
    [images, newInstance.image],
  );

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [instancesData, imagesData] = await Promise.all([
        fetchJson("/instances"),
        fetchJson("/images"),
      ]);
      setInstances(instancesData.instances || []);
      setImages(imagesData.allowed || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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

  const handleCopyUrl = async (id: string) => {
    const url = buildProxyUrl(id, proxyBase);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      } else {
        window.prompt("Copy proxy URL", url);
      }
    } catch (err) {
      console.warn(err);
      window.prompt("Copy proxy URL", url);
    }
  };

  const handleImageChange = (value: string) => {
    const matched = images.find((image) => image.name === value);
    setNewInstance((prev) => ({
      ...prev,
      image: value,
      containerPort: matched ? matched.defaultPort.toString() : prev.containerPort,
    }));
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200">
          {error}
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-3xl bg-slate-900/70 p-6 shadow-xl ring-1 ring-white/10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Instances</h2>
            <button
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200"
              onClick={loadData}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <div className="mt-4 space-y-4">
            {instances.length === 0 ? (
              <p className="text-sm text-slate-300">No instances running yet.</p>
            ) : (
              instances.map((instance) => {
                const proxyUrl = buildProxyUrl(instance.id, proxyBase);
                return (
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
                      <p className="mt-2 text-xs text-slate-300">Proxy: {proxyUrl}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200"
                        onClick={() => handleCopyUrl(instance.id)}
                      >
                        {copiedId === instance.id ? "Copied" : "Copy proxy URL"}
                      </button>
                      <button
                        className="rounded-xl border border-rose-400/40 px-4 py-2 text-xs text-rose-200"
                        onClick={() => handleStopInstance(instance.id)}
                      >
                        Stop instance
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-3xl bg-slate-900/70 p-6 shadow-xl ring-1 ring-white/10">
          <h2 className="text-lg font-semibold text-white">Launch new instance</h2>
          <div className="mt-4 space-y-3">
            <div>
              <input
                className="w-full rounded-xl border border-slate-700 bg-white px-4 py-2 text-sm"
                placeholder="Select image"
                list="allowed-images"
                value={newInstance.image}
                onChange={(event) => handleImageChange(event.target.value)}
              />
              <datalist id="allowed-images">
                {images.map((image) => (
                  <option key={image.id} value={image.name}>
                    {image.description}
                  </option>
                ))}
              </datalist>
              {selectedImage && (
                <p className="mt-2 text-xs text-slate-400">
                  {selectedImage.description} · Default port {selectedImage.defaultPort}
                </p>
              )}
            </div>
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
    </div>
  );
}
