import 'server-only';
import { createClient } from '@supabase/supabase-js';
export function authConfigured() {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.KAKAO_REST_API_KEY && process.env.KAKAO_CLIENT_SECRET &&
    (process.env.GAME_SIGNING_SECRET?.length ?? 0) >= 32);
}
export function rankingConfigured() { return authConfigured(); }
export function database() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}
