import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { allowedImages as seedImages } from "./allowedImages.js";

export type UserRecord = {
  id: number;
  username: string;
  passwordHash: string;
  role: "admin" | "user";
  createdAt: string;
};

export type AllowedImageRecord = {
  id: number;
  name: string;
  dockerHubUrl: string;
  defaultPort: number;
  description: string;
  createdAt: string;
};

export type SessionRecord = {
  token: string;
  userId: number;
  createdAt: string;
};

const dbPath = process.env.RADOME_DB_PATH ?? "./data/radome.db";
export const db = new Database(dbPath);

export const initDb = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS allowed_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      dockerHubUrl TEXT NOT NULL,
      defaultPort INTEGER NOT NULL,
      description TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      userId INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  seedDefaults();
};

const seedDefaults = () => {
  const imageCount = db.prepare("SELECT COUNT(*) as count FROM allowed_images").get() as {
    count: number;
  };

  if (imageCount.count === 0) {
    const insert = db.prepare(
      "INSERT INTO allowed_images (name, dockerHubUrl, defaultPort, description, createdAt) VALUES (?, ?, ?, ?, ?)",
    );
    const now = new Date().toISOString();
    for (const image of seedImages) {
      insert.run(image.name, image.dockerHubUrl, image.defaultPort, image.description, now);
    }
  }

  const adminUsername = process.env.RADOME_ADMIN_USERNAME ?? "admin";
  const adminPassword = process.env.RADOME_ADMIN_PASSWORD ?? "radome";

  const existingAdmin = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(adminUsername) as { id?: number } | undefined;

  if (!existingAdmin?.id) {
    const now = new Date().toISOString();
    const passwordHash = bcrypt.hashSync(adminPassword, 10);
    db.prepare(
      "INSERT INTO users (username, passwordHash, role, createdAt) VALUES (?, ?, ?, ?)",
    ).run(adminUsername, passwordHash, "admin", now);
  }
};

export const listAllowedImages = () =>
  db.prepare("SELECT * FROM allowed_images ORDER BY name").all() as AllowedImageRecord[];

export const getAllowedImageByName = (name: string) =>
  db.prepare("SELECT * FROM allowed_images WHERE name = ?").get(name) as
    | AllowedImageRecord
    | undefined;

export const createAllowedImage = (input: Omit<AllowedImageRecord, "id" | "createdAt">) => {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      "INSERT INTO allowed_images (name, dockerHubUrl, defaultPort, description, createdAt) VALUES (?, ?, ?, ?, ?)",
    )
    .run(input.name, input.dockerHubUrl, input.defaultPort, input.description, now);
  return db
    .prepare("SELECT * FROM allowed_images WHERE id = ?")
    .get(result.lastInsertRowid) as AllowedImageRecord;
};

export const updateAllowedImage = (
  id: number,
  input: Omit<AllowedImageRecord, "id" | "createdAt">,
) => {
  db.prepare(
    "UPDATE allowed_images SET name = ?, dockerHubUrl = ?, defaultPort = ?, description = ? WHERE id = ?",
  ).run(input.name, input.dockerHubUrl, input.defaultPort, input.description, id);

  return db.prepare("SELECT * FROM allowed_images WHERE id = ?").get(id) as
    | AllowedImageRecord
    | undefined;
};

export const deleteAllowedImage = (id: number) => {
  const result = db.prepare("DELETE FROM allowed_images WHERE id = ?").run(id);
  return result.changes > 0;
};

export const getUserByUsername = (username: string) =>
  db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRecord | undefined;

export const getUserById = (id: number) =>
  db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined;

export const createUser = (username: string, passwordHash: string, role: "admin" | "user") => {
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO users (username, passwordHash, role, createdAt) VALUES (?, ?, ?, ?)")
    .run(username, passwordHash, role, now);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid) as UserRecord;
};

export const listUsers = () =>
  db.prepare("SELECT id, username, role, createdAt FROM users ORDER BY id").all() as Array<
    Omit<UserRecord, "passwordHash">
  >;

export const createSession = (token: string, userId: number) => {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)").run(
    token,
    userId,
    now,
  );
};

export const getSession = (token: string) =>
  db.prepare("SELECT * FROM sessions WHERE token = ?").get(token) as
    | SessionRecord
    | undefined;

export const deleteSession = (token: string) => {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
};
