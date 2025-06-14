/**
 * Utilities for connecting with Supabase
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Gets a Supabase client with URL and key from parameters.
 * 
 * @param url Supabase URL
 * @param key Supabase service key
 * @returns Supabase client instance
 */
export function getSupabaseClient(url: string, key: string): SupabaseClient {
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be provided as parameters");
  }
  
  return createClient(url, key);
}