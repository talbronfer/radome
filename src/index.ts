import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import { compareSync, hashSync } from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import {
  createAllowedImage,
  createSession,
  createUser,
  deleteAllowedImage,
  deleteSession,
  getAllowedImageByName,
  getSession,
  getUserById,
  getUserByUsername,
  initDb,
  listAllowedImages,
  listUsers,
  updateAllowedImage,
} from "./db.js";
import { createInstance, listInstances, removeInstance } from "./instances.js";
import { startProxy } from "./proxy.js";

const PORT = Number(process.env.RADOME_CONTROL_PORT ?? 3000);
const PROXY_PORT = Number(process.env.RADOME_PROXY_PORT ?? 8080);
const BASE_DOMAIN = process.env.RADOME_BASE_DOMAIN ?? "radome.local";

initDb();

const app = express();
app.use(express.json());

type AuthRequest = Request & { user?: { id: number; role: string } };

const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const session = getSession(token);
  if (!session) {
    res.status(401).json({ error: "invalid token" });
    return;
  }

  const user = getUserById(session.userId);
  if (!user) {
    res.status(401).json({ error: "user not found" });
    return;
  }

  req.user = { id: user.id, role: user.role };
  next();
};

const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "admin required" });
    return;
  }
  next();
};

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "username and password required" });
    return;
  }

  const user = getUserByUsername(username);
  if (!user || !compareSync(password, user.passwordHash)) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }

  const token = uuidv4();
  createSession(token, user.id);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.post("/auth/logout", authenticate, (req: AuthRequest, res) => {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.replace("Bearer", "").trim();
  deleteSession(token);
  res.status(204).send();
});

app.get("/images", authenticate, (_req, res) => {
  res.json({
    allowed: listAllowedImages(),
  });
});

app.post("/images", authenticate, requireAdmin, (req, res) => {
  const { name, dockerHubUrl, defaultPort, description } = req.body ?? {};
  if (
    typeof name !== "string" ||
    typeof dockerHubUrl !== "string" ||
    typeof defaultPort !== "number" ||
    typeof description !== "string"
  ) {
    res.status(400).json({ error: "invalid payload" });
    return;
  }

  try {
    const record = createAllowedImage({ name, dockerHubUrl, defaultPort, description });
    res.status(201).json({ image: record });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.put("/images/:id", authenticate, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name, dockerHubUrl, defaultPort, description } = req.body ?? {};
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }

  if (
    typeof name !== "string" ||
    typeof dockerHubUrl !== "string" ||
    typeof defaultPort !== "number" ||
    typeof description !== "string"
  ) {
    res.status(400).json({ error: "invalid payload" });
    return;
  }

  const record = updateAllowedImage(id, { name, dockerHubUrl, defaultPort, description });
  if (!record) {
    res.status(404).json({ error: "image not found" });
    return;
  }

  res.json({ image: record });
});

app.delete("/images/:id", authenticate, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const removed = deleteAllowedImage(id);
  if (!removed) {
    res.status(404).json({ error: "image not found" });
    return;
  }

  res.status(204).send();
});

app.get("/users", authenticate, requireAdmin, (_req, res) => {
  res.json({ users: listUsers() });
});

app.post("/users", authenticate, requireAdmin, (req, res) => {
  const { username, password, role } = req.body ?? {};
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    (role !== "admin" && role !== "user")
  ) {
    res.status(400).json({ error: "invalid payload" });
    return;
  }

  try {
    const passwordHash = hashSync(password, 10);
    const user = createUser(username, passwordHash, role);
    res.status(201).json({ user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.get("/instances", authenticate, (_req, res) => {
  res.json({
    instances: listInstances(),
  });
});

app.post("/instances", authenticate, async (req, res) => {
  const { image, containerPort, name, env, command } = req.body ?? {};

  if (!image || typeof image !== "string") {
    res.status(400).json({ error: "image is required" });
    return;
  }

  const allowedImage = getAllowedImageByName(image);
  if (!allowedImage) {
    res.status(400).json({
      error: "image not allowed",
      allowedImages: listAllowedImages(),
    });
    return;
  }

  if (containerPort && typeof containerPort !== "number") {
    res.status(400).json({ error: "containerPort must be a number" });
    return;
  }

  try {
    const instance = await createInstance({
      image: allowedImage,
      containerPort,
      name: typeof name === "string" ? name : undefined,
      env: typeof env === "object" && env ? env : undefined,
      command: Array.isArray(command) ? command : undefined,
    });

    const url = `http://${instance.id}.${BASE_DOMAIN}:${PROXY_PORT}`;

    res.status(201).json({
      instance,
      url,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete("/instances/:id", authenticate, async (req, res) => {
  const removed = await removeInstance(req.params.id);
  if (!removed) {
    res.status(404).json({ error: "instance not found" });
    return;
  }

  res.status(204).send();
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Radome control API listening on ${PORT}`);
});

startProxy({ baseDomain: BASE_DOMAIN, port: PROXY_PORT });
