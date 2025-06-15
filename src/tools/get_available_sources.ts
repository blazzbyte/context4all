import { experimental_PaidMcpAgent as PaidMcpAgent } from "@stripe/agent-toolkit/cloudflare";
import { getSupabaseClient } from "../utils/supabase";

export function getAvailableSourcesTool(
  agent: PaidMcpAgent<Env, any, any>,
  env?: {
    SUPABASE_URL: string;
    SUPABASE_SERVICE_KEY: string;
  }
) {
  const server = agent.server;

  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_KEY) {
    throw new Error("Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY");
  }

  // @ts-ignore
  server.tool(
    "get_available_sources",
    `Get all available sources from the sources table.

This tool returns a list of all unique sources (domains) that have been crawled and stored
in the database, along with their summaries and statistics. This is useful for discovering 
what content is available for querying.

Always use this tool before calling the RAG query or code example query tool
with a specific source filter!`,
    {},
    async () => {
      try {
        // Get Supabase client
        const supabaseClient = getSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

        // Get user ID from agent props
        const userId = agent.props?.userId;
        
        // Query the sources table directly with user_id filter if available
        let query = supabaseClient.from('sources').select('*');
        
        // Apply user_id filter if userId is available
        if (userId) {
          query = query.eq('user_id', userId);
        }
        
        // Execute the query and order by source_id
        const { data, error } = await query.order('source_id');

        if (error) {
          throw new Error(`Supabase query error: ${error.message}`);
        }

        // Format the sources with their details
        const sources = [];
        if (data) {
          for (const source of data) {
            sources.push({
              source_id: source.source_id,
              summary: source.summary,
              total_words: source.total_words,
              created_at: source.created_at,
              updated_at: source.updated_at
            });
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              sources: sources,
              count: sources.length
            }, null, 2)
          }]
        };

      } catch (error) {
        console.error('Error getting available sources:', error);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: (error as Error).message
            }, null, 2)
          }]
        };
      }
    }
  );
}
