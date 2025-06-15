import { z } from "zod";
import { experimental_PaidMcpAgent as PaidMcpAgent } from "@stripe/agent-toolkit/cloudflare";
import { getSupabaseClient } from "../utils/supabase";
import { searchDocuments } from "../utils/documents";
import { rerankAndMergeResults } from "../utils/reranker";
import { logRetrieverResults } from "../utils/langsmith";
import OpenAI from "openai";
import { Client } from "langsmith";
import { wrapOpenAI } from "langsmith/wrappers";

export function performRagQueryTool(
    agent: PaidMcpAgent<Env, any, any>,
    env?: {
        SUPABASE_URL: string;
        SUPABASE_SERVICE_KEY: string;
        LLM_API_KEY?: string;
        LLM_API_URL?: string;
        MODEL_EMBEDDING?: string;
        USE_HYBRID_SEARCH?: string;
        USE_RERANKING?: string;
        COHERE_API_KEY?: string;
        LANGSMITH_API_KEY?: string;
        LANGSMITH_ENDPOINT?: string;
        LANGSMITH_PROJECT?: string;
    }
) {
    const server = agent.server;

    if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_KEY) {
        throw new Error("Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY");
    }

    // @ts-ignore
    server.tool(
        "perform_rag_query",
        `Perform a RAG (Retrieval Augmented Generation) query on the stored content.

This tool searches the vector database for content relevant to the query and returns
the matching documents. Optionally filter by source domain.
Get the source by using the get_available_sources tool before calling this search!`,
        {
            query: z.string().describe("The search query"),
            source: z.string().optional().describe("Optional source domain to filter results (e.g., 'example.com')"),
            match_count: z.number().min(1).max(20).optional().default(5).describe("Maximum number of results to return (default: 5)")
        },
        async ({ query, source, match_count = 5 }: {
            query: string;
            source?: string;
            match_count?: number;
        }) => {
            try {
                // Initialize LangSmith client for tracing if API key is provided
                const langsmithClient = new Client({
                    apiKey: env.LANGSMITH_API_KEY || "",
                    apiUrl: env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com",
                });

                // Get Supabase client
                const supabaseClient = getSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

                // Create OpenAI client if LLM API key is provided
                const openaiClient = wrapOpenAI(new OpenAI({
                    apiKey: env.LLM_API_KEY,
                    ...(env.LLM_API_URL && { baseURL: env.LLM_API_URL })
                }), {
                    name: "perform_rag_query",
                    run_type: "llm",
                    client: langsmithClient,
                    tracingEnabled: true,
                    project_name: env.LANGSMITH_PROJECT || "Testing"
                });

                // Get model choices
                const modelEmbedding = env.MODEL_EMBEDDING || "text-embedding-3-small";

                // Check if hybrid search is enabled
                const useHybridSearch = env.USE_HYBRID_SEARCH === "true";

                // Prepare filter if source is provided and not empty
                let filterMetadata: Record<string, any> | undefined = undefined;
                if (source && source.trim()) {
                    filterMetadata = { source: source };
                }

                // Get user ID from agent props and add to filter
                const userId = agent.props?.userId;

                let results: any[] = [];

                if (useHybridSearch) {
                    // Hybrid search: combine vector and keyword search

                    // 1. Get vector search results (get more to account for filtering)
                    const vectorResults = await searchDocuments(
                        supabaseClient,
                        query,
                        openaiClient,
                        modelEmbedding,
                        match_count * 2, // Get double to have room for filtering
                        filterMetadata,
                        userId
                    );

                    // 2. Get keyword search results using ILIKE
                    let keywordQuery = supabaseClient
                        .from('crawled_pages')
                        .select('id, url, chunk_number, content, metadata, source_id')
                        .ilike('content', `%${query}%`);

                    // Apply source filter if provided
                    if (source && source.trim()) {
                        keywordQuery = keywordQuery.eq('source_id', source);
                    }

                    // Apply user_id filter if available
                    if (userId) {
                        keywordQuery = keywordQuery.eq('user_id', userId);
                    }

                    // Execute keyword search
                    const { data: keywordResults, error: keywordError } = await keywordQuery.limit(match_count * 2);

                    if (keywordError) {
                        console.log(`Keyword search error: ${keywordError.message}`);
                    }

                    // 3. Combine results with preference for items appearing in both
                    const seenIds = new Set<string>();
                    const combinedResults: any[] = [];

                    // First, add items that appear in both searches (these are the best matches)
                    const vectorIds = new Set(vectorResults.map(r => r.id).filter(id => id));

                    if (keywordResults) {
                        for (const kr of keywordResults) {
                            if (vectorIds.has(kr.id) && !seenIds.has(kr.id)) {
                                // Find the vector result to get similarity score
                                for (const vr of vectorResults) {
                                    if (vr.id === kr.id) {
                                        // Boost similarity score for items in both results
                                        vr.similarity = Math.min(1.0, (vr.similarity || 0) * 1.2);
                                        combinedResults.push(vr);
                                        seenIds.add(kr.id);
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // Then add remaining vector results (semantic matches without exact keyword)
                    for (const vr of vectorResults) {
                        if (vr.id && !seenIds.has(vr.id) && combinedResults.length < match_count) {
                            combinedResults.push(vr);
                            seenIds.add(vr.id);
                        }
                    }

                    // Finally, add pure keyword matches if we still need more results
                    if (keywordResults) {
                        for (const kr of keywordResults) {
                            if (!seenIds.has(kr.id) && combinedResults.length < match_count) {
                                // Convert keyword result to match vector result format
                                combinedResults.push({
                                    id: kr.id,
                                    url: kr.url,
                                    chunk_number: kr.chunk_number,
                                    content: kr.content,
                                    metadata: kr.metadata,
                                    source_id: kr.source_id,
                                    similarity: 0.5 // Default similarity for keyword-only matches
                                });
                                seenIds.add(kr.id);
                            }
                        }
                    }

                    // Use combined results
                    results = combinedResults.slice(0, match_count);

                } else {
                    // Standard vector search only
                    results = await searchDocuments(
                        supabaseClient,
                        query,
                        openaiClient,
                        modelEmbedding,
                        match_count,
                        filterMetadata,
                        userId
                    );
                }

                // Create metadata for LangSmith
                const metadata = {
                    search_mode: useHybridSearch ? "hybrid" : "vector",
                    model_embedding: modelEmbedding,
                    user_id: userId || "anonymous"
                };

                // Log the retrieval operation to LangSmith
                await logRetrieverResults(query, results, metadata, langsmithClient, env.LANGSMITH_PROJECT);

                // Apply reranking if enabled
                const useReranking = env.USE_RERANKING === "true" && env.COHERE_API_KEY;
                let rerankingApplied = false;

                if (useReranking && results.length > 0) {
                    try {
                        results = await rerankAndMergeResults(query, results, "content", "rerank-multilingual-v3.0", env.COHERE_API_KEY);
                        rerankingApplied = true;
                    } catch (error) {
                        console.log(`Reranking failed: ${error}. Using original results.`);
                    }
                }

                // Format the results
                const formattedResults = [];
                for (const result of results) {
                    const formattedResult: any = {
                        url: result.url,
                        content: result.content,
                        metadata: result.metadata,
                        similarity: result.similarity
                    };

                    // Include rerank score if available
                    if (result.rerank_score !== undefined) {
                        formattedResult.rerank_score = result.rerank_score;
                    }

                    formattedResults.push(formattedResult);
                }

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            query: query,
                            source_filter: source || null,
                            search_mode: useHybridSearch ? "hybrid" : "vector",
                            reranking_applied: rerankingApplied,
                            results: formattedResults,
                            count: formattedResults.length
                        }, null, 2)
                    }]
                };

            } catch (error) {
                console.error('Error performing RAG query:', error);
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            query: query,
                            error: (error as Error).message
                        }, null, 2)
                    }]
                };
            }
        }
    );
}
