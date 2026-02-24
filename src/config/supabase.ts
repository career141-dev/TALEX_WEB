import { createClient } from "@supabase/supabase-js";
import { config } from "./env";

// Admin client (server-side only — has full access)
export const supabaseAdmin = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_KEY
);

// Anon client (validate user tokens)
export const supabase = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_ANON_KEY
);
