import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { GoogleHandler } from "./auth/google-handler";
import { Props } from "./auth/oauth";
import {
	PaymentState,
	experimental_PaidMcpAgent as PaidMcpAgent,
  } from '@stripe/agent-toolkit/cloudflare';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import stripeWebhookHandler from "./webhooks/stripe";
import * as tools from './tools';

type State = PaymentState & {};

type AgentProps = Props & {
	STRIPE_SUBSCRIPTION_PRICE_ID: string;
	BASE_URL: string;
};

// Define our MCP agent with tools
export class Context4AllMCP extends PaidMcpAgent<Env, State, AgentProps> {
	server = new McpServer({
		name: "Context4all MCP",
		version: "1.0.0",
	});

	async init() {
		// crawl_single_page tool
		tools.crawlSinglePageTool(this, {
			SUPABASE_URL: this.env.SUPABASE_URL,
			SUPABASE_SERVICE_KEY: this.env.SUPABASE_SERVICE_KEY,
			BROWSERLESS_TOKEN: this.env.BROWSERLESS_TOKEN,
			BROWSERLESS_URL: this.env.BROWSERLESS_URL,
			COHERE_API_KEY: this.env.COHERE_API_KEY,
			USE_AGENTIC_RAG: this.env.USE_AGENTIC_RAG,
			LLM_API_KEY: this.env.LLM_API_KEY,
			LLM_API_URL: this.env.LLM_API_URL,
			MODEL_CHOICE: this.env.MODEL_CHOICE,
			MODEL_EMBEDDING: this.env.MODEL_EMBEDDING,
			USE_CONTEXTUAL_EMBEDDINGS: this.env.USE_CONTEXTUAL_EMBEDDINGS
		});

		// smart_crawl_url tool
		tools.smartCrawlUrlTool(this, {
			SUPABASE_URL: this.env.SUPABASE_URL,
			SUPABASE_SERVICE_KEY: this.env.SUPABASE_SERVICE_KEY,
			BROWSERLESS_TOKEN: this.env.BROWSERLESS_TOKEN,
			BROWSERLESS_URL: this.env.BROWSERLESS_URL,
			COHERE_API_KEY: this.env.COHERE_API_KEY,
			USE_AGENTIC_RAG: this.env.USE_AGENTIC_RAG,
			LLM_API_KEY: this.env.LLM_API_KEY,
			LLM_API_URL: this.env.LLM_API_URL,
			MODEL_CHOICE: this.env.MODEL_CHOICE,
			MODEL_EMBEDDING: this.env.MODEL_EMBEDDING,
			USE_CONTEXTUAL_EMBEDDINGS: this.env.USE_CONTEXTUAL_EMBEDDINGS
		});

		// get_available_sources tool
		tools.getAvailableSourcesTool(this, {
			SUPABASE_URL: this.env.SUPABASE_URL,
			SUPABASE_SERVICE_KEY: this.env.SUPABASE_SERVICE_KEY
		});

		// perform_rag_query tool
		tools.performRagQueryTool(this, {
			SUPABASE_URL: this.env.SUPABASE_URL,
			SUPABASE_SERVICE_KEY: this.env.SUPABASE_SERVICE_KEY,
			LLM_API_KEY: this.env.LLM_API_KEY,
			LLM_API_URL: this.env.LLM_API_URL,
			MODEL_EMBEDDING: this.env.MODEL_EMBEDDING,
			USE_HYBRID_SEARCH: this.env.USE_HYBRID_SEARCH,
			USE_RERANKING: this.env.USE_RERANKING,
			COHERE_API_KEY: this.env.COHERE_API_KEY
		});

		// search_code_examples tool
		tools.searchCodeExamplesTool(this, {
			SUPABASE_URL: this.env.SUPABASE_URL,
			SUPABASE_SERVICE_KEY: this.env.SUPABASE_SERVICE_KEY,
			LLM_API_KEY: this.env.LLM_API_KEY,
			LLM_API_URL: this.env.LLM_API_URL,
			MODEL_EMBEDDING: this.env.MODEL_EMBEDDING,

			USE_HYBRID_SEARCH: this.env.USE_HYBRID_SEARCH,
			USE_RERANKING: this.env.USE_RERANKING,
			USE_AGENTIC_RAG: this.env.USE_AGENTIC_RAG,

			COHERE_API_KEY: this.env.COHERE_API_KEY
		});
	}
}

// Create an OAuth provider instance for auth routes
const oauthProvider = new OAuthProvider({
	apiRoute: "/sse",
	apiHandler: Context4AllMCP.mount("/sse") as any,
	defaultHandler: GoogleHandler as any,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
});

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		
		// Handle homepage
		if (path === "/" || path === "") {
			// @ts-ignore
			const homePage = await import('./pages/index.html');
			return new Response(homePage.default, {
				headers: { "Content-Type": "text/html" },
			});
		}

		// Handle payment success page
		if (path === "/payment/success") {
			// @ts-ignore
			const successPage = await import('./pages/payment-success.html');
			return new Response(successPage.default, {
				headers: { "Content-Type": "text/html" },
			});
		}
		
		// Handle webhook
		if (path === "/webhooks/stripe") {
			return stripeWebhookHandler.fetch(request, env);
		}
		
		// All other routes go to OAuth provider
		return oauthProvider.fetch(request, env, ctx);
	},
};