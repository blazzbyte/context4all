---
description: This rule explains how to create a remote MCP server on Cloudflare with both free and paid tools (using Stripe).
globs: 
alwaysApply: false
---
# Context4All Project Overview

This rule provides a guide to understanding the structure and core functionalities of the Context4All project. It's designed to help you navigate and extend the project effectively.

## Core Architecture

The project is a Cloudflare Worker that implements an MCP (Model Context Protocol) server for indexing information and generating context for LLM models, with built-in support for user authentication and Stripe payments.

-   **Main Entry Point**: `src/index.ts`
    -   Initializes the `Context4AllMCP` agent, which extends `PaidMcpAgent` from `@stripe/agent-toolkit/cloudflare`.
    -   Sets up routing using Hono, handling the homepage (`@src/pages/index.html`), payment success page (`@src/pages/payment-success.html`), and Stripe webhooks (`@src/webhooks/stripe.ts`).
    -   Configures the `OAuthProvider` for handling authentication flows, defaulting to Google (`@src/auth/google-handler.ts`) but switchable to GitHub (`@src/auth/github-handler.ts`).

-   **Configuration**:
    -   `wrangler.jsonc`: Defines Cloudflare Worker settings, including Durable Objects (`Context4AllMCP`), KV namespaces (`OAUTH_KV` for storing OAuth related data), and compatibility flags.
    -   `package.json`: Lists project dependencies like `@modelcontextprotocol/sdk`, `@stripe/agent-toolkit/cloudflare`, `hono`, `zod`, and OAuth providers. It also contains scripts for development (`dev`) and deployment (`deploy`).
    -   `.dev.vars` (from `@.dev.vars.example`): Stores local development secrets and environment variables such as API keys for Google, GitHub, Stripe, and `BASE_URL`.

## Tool Creation

MCP tools are defined in the `src/tools/` directory. Each tool is typically in its own file and then exported via `src/tools/index.ts` to be registered in `src/index.ts` within the `Context4AllMCP.init()` method.

-   **Free Tools**:
    -   Defined using `agent.server.tool()`.
    -   Example: `@src/tools/add.ts` (simple addition) and `@src/tools/calculate.ts` (more complex calculations).
    -   Input parameters are validated using `zod`.

-   **Paid Tools**:
    -   Defined using `agent.paidTool()`. Tools can be subscription-based or metered.
    -   Both types require `BASE_URL` to be passed from environment variables.
    -   **Subscription Tools**:
        -   Require `STRIPE_SUBSCRIPTION_PRICE_ID` (for a recurring subscription product).
        -   Use `REUSABLE_PAYMENT_REASON` from `@src/helpers/constants.ts` for payment prompts.
        -   Example: `@src/tools/subscriptionAdd.ts`.
    -   **Metered Tools**:
        -   Require `STRIPE_METERED_PRICE_ID` (for a metered usage product).
        -   Use a specific `paymentReason` (often combining a custom message with `METERED_TOOL_PAYMENT_REASON` from `@src/helpers/constants.ts`) to inform users about metered billing.
        -   Require a `meterEvent` string in the tool definition, which must match an event name configured in your Stripe meter for that product/price. This event is used to report usage to Stripe.
        -   Example: `@src/tools/meteredAdd.ts`.
    -   The `successUrl` (e.g., `${baseUrl}/payment/success`) redirects users after successful payment for both types, leading to `@src/pages/payment-success.html`.

## Authentication

Authentication is handled by `@cloudflare/workers-oauth-provider`, with specific implementations for Google and GitHub.

-   **Handlers**:
    -   `@src/auth/google-handler.ts`: Manages the Google OAuth2 flow.
    -   `@src/auth/github-handler.ts`: Manages the GitHub OAuth flow.
-   **Utilities**:
    -   `@src/auth/oauth.ts`: Contains helper functions like `getUpstreamAuthorizeUrl` and `fetchUpstreamAuthToken` for interacting with OAuth providers.
    -   `@src/auth/workers-oauth-utils.ts`: Provides utilities for rendering an approval dialog (`renderApprovalDialog`) and managing client approval status via cookies (`clientIdAlreadyApproved`, `parseRedirectApproval`). This uses a `COOKIE_ENCRYPTION_KEY` from `.dev.vars`.
-   **Storage**: The `OAUTH_KV` namespace (configured in `wrangler.jsonc`) is used by the OAuth provider, likely for storing state or tokens related to the OAuth process.

## Payment Integration (Stripe)

Payments for paid tools are managed through Stripe integration, supporting both subscription and metered billing.

-   **Core Component**: `experimental_PaidMcpAgent` from `@stripe/agent-toolkit/cloudflare` is the base for `Context4AllMCP`, enabling paid tool functionality.
-   **Configuration**: Requires `STRIPE_SECRET_KEY` in `.dev.vars`. For subscription tools, `STRIPE_SUBSCRIPTION_PRICE_ID` is needed. For metered tools, `STRIPE_METERED_PRICE_ID` is needed.
-   **Webhook (Optional)**: `@src/webhooks/stripe.ts` handles incoming Stripe webhooks (e.g., `checkout.session.completed`) if configured. This requires `STRIPE_WEBHOOK_SECRET`.
-   **Payment Flow**: When a user attempts to use a paid tool without prior payment, the `PaidMcpAgent` initiates a Stripe Checkout session. The `paymentReason` informs the user. For metered tools, usage is reported via a `meterEvent` defined in the tool, which corresponds to a Stripe meter.

## Frontend Pages

Simple HTML pages are served for basic interactions:
- `@src/pages/index.html`: A basic welcome page.
- `@src/pages/payment-success.html`: Shown after a user successfully completes a Stripe payment.

## Setup and Development

Refer to `@README.md` for detailed step-by-step instructions on setting up the project, including installing dependencies, configuring Cloudflare KV and secrets, and setting up OAuth applications and Stripe products.
Key commands from `package.json`:
- `npm run dev` (via `wrangler dev`): Starts the local development server.
- `npm run deploy` (via `wrangler deploy`): Deploys the worker to Cloudflare.