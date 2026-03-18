import { createClient } from "@supabase/supabase-js";
import { config } from "./env";

import fs from 'fs';
import path from 'path';

// File-based storage shim for server-side PKCE (survives ts-node-dev restarts)
const STORAGE_FILE = path.resolve(process.cwd(), 'temp-auth-storage.json');

export const getStorage = () => {
    try {
        if (!fs.existsSync(STORAGE_FILE)) return {};
        return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf-8'));
    } catch { return {}; }
};

export const saveStorage = (data: any) => {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
};

const serverOptions = {
    auth: {
        storage: {
            getItem: (key: string) => getStorage()[key] || null,
            setItem: (key: string, value: string) => {
                const data = getStorage();
                data[key] = value;
                saveStorage(data);
            },
            removeItem: (key: string) => {
                const data = getStorage();
                delete data[key];
                saveStorage(data);
            },
        },
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: false,
    },
};

// ⚠️ NEVER expose the service key or this admin client to the frontend.
// Admin client (server-side only) - has full service role access bypassing RLS.
if (!config.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_KEY is required but not set. Server cannot start.');
}

// Admin client should be stateless to ensure it always uses service_role power
export const supabaseAdmin = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        }
    }
);

// Anon client (validate user tokens) - uses file-based storage for session persistence
export const supabase = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_ANON_KEY,
    serverOptions
);
