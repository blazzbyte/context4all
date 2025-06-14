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
		// Example free tools (that don't require payment but do require a logged in user)
		tools.addTool(this);
		tools.calculateTool(this);

		// Example of a paid tool that requires a logged in user and a one-time payment
		tools.onetimeAddTool(this, {
			STRIPE_ONE_TIME_PRICE_ID: this.env.STRIPE_ONE_TIME_PRICE_ID,
			BASE_URL: this.env.BASE_URL
		});
		
		// Add the crawl_single_page tool with all required API keys
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