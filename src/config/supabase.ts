import { createClient } from "@supabase/supabase-js";
import { config } from "./env";

// Shared server-side options to disable session persistence and auto-refresh.
// This prevents memory leaks and console warnings in a backend environment.
const serverOptions = {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
    },
};

// ⚠️ NEVER expose the service key or this admin client to the frontend.
// Admin client (server-side only) - has full service role access bypassing RLS.
if (!config.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_KEY is required but not set. Server cannot start.');
}

export const supabaseAdmin = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_KEY,
    serverOptions
);

// Anon client (validate user tokens)
export const supabase = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_ANON_KEY,
    serverOptions
);
