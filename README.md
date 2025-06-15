# Context4All: Intelligent Context Generation for LLMs

A powerful MCP (Model Context Protocol) server built on Cloudflare Workers, designed to index information, generate rich context for Large Language Models (LLMs), and seamlessly integrate advanced features like Retrieval Augmented Generation (RAG), user authentication, and Stripe-powered monetization for your AI tools.

## Support Us

If you find this project helpful and would like to support future projects, consider buying us a coffee! Your support helps us continue building innovative AI solutions.

<a href="https://www.buymeacoffee.com/blazzmocompany"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=blazzmocompany&button_colour=40DCA5&font_colour=ffffff&font_family=Cookie&outline_colour=000000&coffee_colour=FFDD00"></a>

Your contributions go a long way in fueling our passion for creating intelligent and user-friendly applications.

## Table of Contents

- [Introduction](#introduction)
- [Features](#features)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Client Setup](#client-setup)
  - [Trae AI IDE](#trae-ai-ide)
  - [Cursor IDE](#cursor-ide)
  - [Windsurf IDE](#windsurf-ide)
  - [Claude Desktop](#claude-desktop)
  - [Cline](#cline)
  - [Roo Code](#roo-code)
- [Learn More](#learn-more)
- [Contributing](#contributing)
- [License](#license)

## Introduction

Are you looking to supercharge your LLM applications with relevant, dynamic, and monetizable context? **Context4All** provides a robust and scalable solution. This project implements an MCP server that not only serves as a foundation for your AI tools but also offers advanced capabilities like **Retrieval Augmented Generation (RAG)** for querying your own data sources, flexible **monetization options via Stripe**, and secure **user authentication**.

Built on the efficient **Cloudflare Workers** platform, Context4All is designed for performance and ease of deployment. Whether you're building sophisticated AI agents, internal knowledge bases, or commercial AI-powered services, Context4All offers the **foundational infrastructure** you need.

Main benefits and use cases include:
- **Building custom AI agents** that can leverage external knowledge bases.
- Creating **intelligent search and Q&A systems** over private or public data.
- Developing **monetizable AI tools** with subscription or usage-based billing.
- **Enhancing LLM responses** with up-to-date and specific information.

## Features

- **MCP Server Implementation**: Adheres to the Model Context Protocol for standardized AI tool interaction.
- **Cloudflare Workers Based**: Leverages the serverless, scalable, and performant Cloudflare Workers environment.
- **Retrieval Augmented Generation (RAG)**: 
    - **Web Crawling**: Tools like `crawl_single_page.ts` and `smart_crawl_url.ts` for fetching and processing web content.
    - **Content Ingestion**: Automatic chunking, metadata extraction, summary generation, and embedding creation (via Cohere or OpenAI).
    - **Vector Storage**: Utilizes Supabase as a vector database for efficient similarity search.
    - **Querying**: `perform_rag_query.ts` allows querying indexed data, and `search_code_examples.ts` for specific code snippet retrieval.
- **Flexible Tool Monetization**: 
    - **Stripe Integration**: Seamlessly integrate Stripe for paid tools using `@stripe/agent-toolkit/cloudflare`.
    - **Payment Models**: Supports one-time, subscription, and metered billing for your MCP tools.
- **User Authentication**: 
    - **OAuth 2.0**: Built-in support for Google and GitHub authentication using `@cloudflare/workers-oauth-provider`.
    - **Secure**: Manages OAuth flows and token storage.
- **Modular Tool Design**: Tools are organized in individual modules within `src/tools/` for easy extension and management.
- **TypeScript & Hono**: Modern tech stack with TypeScript for type safety and Hono for fast routing.
- **Environment Configuration**: Easy setup using `.dev.vars` for local development and Cloudflare environment variables for deployment.
- **Stripe Webhook Handling**: Dedicated handler (`src/webhooks/stripe.ts`) for Stripe events.
- **Durable Objects**: Utilizes Cloudflare Durable Objects for stateful operations related to the MCP agent.

## Getting Started

Follow these steps to get your Context4All server up and running.

### Prerequisites

Before you begin, ensure you have the following installed and configured:

- **Node.js and npm**: Latest LTS version recommended.
- **Cloudflare Account**: To deploy your worker.
- **Wrangler CLI**: The command-line tool for Cloudflare Workers. Install via `npm install -g wrangler`.
- **API Keys & Secrets**:
    - `STRIPE_SECRET_KEY`: For Stripe integration.
    - `STRIPE_ONE_TIME_PRICE_ID`, `STRIPE_SUBSCRIPTION_PRICE_ID`, `STRIPE_METERED_PRICE_ID`: (As needed for your paid tools).
    - `STRIPE_WEBHOOK_SECRET`: (If using the Stripe webhook handler).
    - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: For Google OAuth.
    - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: For GitHub OAuth.
    - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: For Supabase integration.
    - `COHERE_API_KEY`: For Cohere reranking generation.
    - `OPENAI_API_KEY`: For OpenAI summary generation and embeddings.
    - `BROWSERLESS_API_KEY`: For using Browserless.io for crawling.
    - `BASE_URL`: The base URL where your worker will be deployed (e.g., `https://your-worker.your-domain.workers.dev`).
    - `COOKIE_ENCRYPTION_KEY`: A secret key for encrypting OAuth cookies.
- **Cloudflare KV Namespace**: Create a KV namespace named `OAUTH_KV` in your Cloudflare dashboard and bind it in your `wrangler.jsonc`.

### Installation

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/your-username/context4all.git # Replace with your repository URL
    cd context4all
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment Variables**:
    -   Copy the `.dev.vars.example` file to `.dev.vars`:
        ```bash
        cp .dev.vars.example .dev.vars
        ```
    -   Open `.dev.vars` and fill in all the required API keys and secrets obtained in the Prerequisites section.

4.  **Configure `wrangler.jsonc` (if necessary)**:
    -   Ensure your `wrangler.jsonc` (or `wrangler.toml`) is correctly configured, especially the `kv_namespaces` for `OAUTH_KV` and `durable_objects` bindings for `Context4AllMCP`.

5.  **Local Development**:
    -   To run the project locally for development and testing:
        ```bash
        npx wrangler dev
        ```
    -   This will start a local server, typically accessible at `http://localhost:8787`.

6.  **Deployment to Cloudflare**:
    -   To deploy your worker to your Cloudflare account:
        ```bash
        npx wrangler deploy
        ```
    -   Wrangler will build and deploy your project. After deployment, it will provide you with the URL of your live worker.
    -   **Important**: After the first deployment, ensure you set up all necessary environment variables (secrets) in your Cloudflare Worker's dashboard settings (under Variables).

## Client Setup

To integrate your Context4All server with your AI tools, you'll need to configure your client to use the MCP protocol. The following sections outline how to set up various AI IDEs and tools to work with Context4All.

### Trae AI IDE

Trae AI IDE provides built-in MCP support with both marketplace and manual configuration options. For SSE transport setup:

**Configuration Method:**
1. Access MCP settings through the AI sidebar settings icon
2. Choose between MCP marketplace or manual configuration
3. For SSE servers, use the manual configuration with JSON format 

**SSE Configuration Example:**
```json
{
  "mcpServers": {
    "custom-server": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp-context4all.nrwrntemporal1.workers.dev/sse"
      ]
    }
  }
}
```

### Cursor IDE

Cursor IDE (version 0.4.5.9 or later) supports MCP servers through its Features section. Cursor has robust support for SSE-based remote servers.

**Setup Process:**
1. Open Cursor Settings → Features → MCP Servers
2. Click "Add New MCP Server"
3. Configure using stdio for local servers or SSE for remote servers

**SSE Configuration:**
```json
{
  "mcpServers": {
    "custom-server": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp-context4all.nrwrntemporal1.workers.dev/sse"
      ]
    }
  }
}
```

**Note:** Cursor supports remote SSE servers, unlike Claude Desktop which has limitations with SSE endpoints.

### Windsurf IDE

Windsurf offers superior MCP server support with built-in capabilities and easy configuration compared to alternatives. It supports two transport mechanisms:

**Supported Transports:**
- **stdio:** Standard input/output for direct communication
- **SSE:** Server-Sent Events using URLs like `https://your-server-url/sse`

**Configuration:**
Windsurf provides plug-and-play MCP server support with minimal setup requirements for services like GitHub.

```json
{
  "mcpServers": {
    "custom-server": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp-context4all.nrwrntemporal1.workers.dev/sse"
      ]
    }
  }
}
```
### Claude Desktop

Claude Desktop has specific limitations regarding SSE transport support. While it supports MCP servers, it primarily uses stdio transport for local servers.

**Key Limitations:**
- Claude Desktop does not support SSE MCP servers directly 
- Requires stdio transport with command-based configuration 
- SSE configurations that work in Cursor will not work in Claude Desktop 

**Stdio Configuration (Recommended):**
```json
{
  "mcpServers": {
    "custom-server": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp-context4all.nrwrntemporal1.workers.dev/sse"
      ]
    }
  }
}
```

### Cline (VS Code Extension)

Cline manages MCP server configurations through the `cline_mcp_settings.json` file. It supports both local and remote server configurations.

**Configuration Process:**
1. Open Cline from VS Code sidebar
2. Access MCP settings to modify `cline_mcp_settings.json`
3. Add server configurations with appropriate transport settings

**Configuration Format:**
```json
{
  "mcpServers": {
    "custom-server": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp-context4all.nrwrntemporal1.workers.dev/sse"
      ]
    }
  }
}
```

### Roo Code

Roo Code provides comprehensive MCP integration with support for both global and project-level configurations. It uses a hub-and-spoke architecture for managing multiple MCP server connections.

**Configuration Levels:**
- **Global:** `mcp_settings.json` file
- **Project-level:** `.roo/mcp.json` file in project root

**Configuration Format:**
```json
{
  "mcpServers": {
    "custom-server": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp-context4all.nrwrntemporal1.workers.dev/sse"
      ]
    }
  }
}
```

## Learn More

To understand the technologies used in this project better, refer to their official documentation:

-   [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
-   [Hono Web Framework](https://hono.dev/)
-   [Stripe SDK for Cloudflare Workers (Agent Toolkit)](https://github.com/stripe/agent-toolkit/tree/main/cloudflare)
-   [Stripe API Documentation](https://stripe.com/docs/api)
-   [Model Context Protocol (MCP) SDK](https://github.com/modelcontext/modelcontextprotocol) (Note: Link might need updating to the official SDK repo if different)
-   [Zod Schema Validation](https://zod.dev/)
-   [Cloudflare Workers OAuth Provider](https://github.com/cloudflare/workers-oauth-provider)
-   [Supabase Documentation](https://supabase.com/docs)
-   [Cohere AI Documentation](https://docs.cohere.com/)
-   [OpenAI API Documentation](https://platform.openai.com/docs)
-   [Browserless.io Documentation](https://www.browserless.io/docs/)
-   [Wrangler CLI Documentation](https://developers.cloudflare.com/workers/wrangler/)

## Contributing

We welcome contributions to Context4All! If you'd like to contribute, please follow these steps:

1.  **Fork the Repository**: Create your own fork of the project.
2.  **Create a Branch**: Create a new branch for your feature or bug fix (e.g., `git checkout -b feature/new-tool` or `git checkout -b fix/auth-bug`).
3.  **Make Your Changes**: Implement your feature or fix the bug.
4.  **Test Your Changes**: Ensure your changes work as expected and do not break existing functionality.
5.  **Commit Your Changes**: Write clear and concise commit messages.
6.  **Push to Your Fork**: Push your changes to your forked repository.
7.  **Open a Pull Request**: Submit a pull request to the main Context4All repository. Please provide a detailed description of your changes.

We appreciate your help in making Context4All better!

## License

This project is licensed under the **MIT License**. Please see the `LICENSE` file for more details.

We encourage you to use, modify, and distribute this project as per the license terms. We believe in open collaboration and hope Context4All helps you build amazing AI applications. Your contributions and improvements are always welcome!