"use client";

import { useEffect, useState } from "react";
import { useAdminContext } from "../../lib/admin-context";
import { AllowedImage, parseEnvJson } from "../../lib/admin-data";

export default function ImagesPage() {
  const { fetchJson } = useAdminContext();
  const [images, setImages] = useState<AllowedImage[]>([]);
  const [newImage, setNewImage] = useState({
    name: "",
    dockerHubUrl: "",
    defaultPort: "",
    description: "",
    env: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadImages = async () => {
    setLoading(true);
    setError(null);
    try {
      const imagesData = await fetchJson("/images");
      setImages(imagesData.allowed || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadImages();
  }, []);

  const handleCreateImage = async () => {
    setError(null);
    let envPayload: Record<string, string> | null = null;
    if (newImage.env.trim()) {
      try {
        envPayload = parseEnvJson(newImage.env);
      } catch (err) {
        setError((err as Error).message || "Environment variables must be valid JSON.");
        return;
      }
    }
    try {
      await fetchJson("/images", {
        method: "POST",
        body: JSON.stringify({
          name: newImage.name,
          dockerHubUrl: newImage.dockerHubUrl,
          defaultPort: Number(newImage.defaultPort),
          description: newImage.description,
          env: envPayload,
        }),
      });
      setNewImage({ name: "", dockerHubUrl: "", defaultPort: "", description: "", env: "" });
      await loadImages();
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
    const envInput = prompt(
      "Environment JSON (leave blank for none)",
      image.env ? JSON.stringify(image.env) : "",
    );
    if (envInput === null) {
      return;
    }

    let envPayload: Record<string, string> | null = null;
    if (envInput.trim()) {
      try {
        envPayload = parseEnvJson(envInput);
      } catch (err) {
        setError((err as Error).message || "Environment variables must be valid JSON.");
        return;
      }
    }

    setError(null);
    try {
      await fetchJson(`/images/${image.id}`, {
        method: "PUT",
        body: JSON.stringify({ name, dockerHubUrl, defaultPort, description, env: envPayload }),
      });
      await loadImages();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDeleteImage = async (id: number) => {
    setError(null);
    try {
      await fetchJson(`/images/${id}`, { method: "DELETE" });
      await loadImages();
    } catch (err) {
      setError((err as Error).message);
    }
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
            <h2 className="text-lg font-semibold text-white">Allowed images</h2>
            <button
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200"
              onClick={loadImages}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
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
                    {image.env && (
                      <p className="text-xs text-slate-400">
                        Env: {JSON.stringify(image.env)}
                      </p>
                    )}
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
              onChange={(event) =>
                setNewImage({ ...newImage, dockerHubUrl: event.target.value })
              }
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
            <textarea
              className="w-full rounded-xl border border-slate-700 bg-white px-4 py-2 text-sm"
              placeholder='Env JSON (e.g. {"API_KEY":"value"})'
              rows={3}
              value={newImage.env}
              onChange={(event) => setNewImage({ ...newImage, env: event.target.value })}
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
    </div>
  );
}
