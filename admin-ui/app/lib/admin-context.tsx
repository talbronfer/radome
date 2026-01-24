"use client";

import { createContext, useContext } from "react";
import { apiBase, proxyBase } from "./admin-data";

export type AdminContextValue = {
  token: string | null;
  setToken: (token: string | null) => void;
  apiBase: string;
  proxyBase: string;
  fetchJson: (path: string, options?: RequestInit) => Promise<any>;
};

export const AdminContext = createContext<AdminContextValue | null>(null);

export const useAdminContext = () => {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error("AdminContext is not available.");
  }
  return context;
};

export const defaultAdminContext = {
  apiBase,
  proxyBase,
};
