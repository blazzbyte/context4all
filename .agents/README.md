# Trae Custom Agents

This directory contains examples of custom agents for Trae IDE, following the [official documentation](https://docs.trae.ai/ide/agent?_lang=en).

Each subdirectory represents a different custom agent with:

- A detailed prompt template
- Recommended MCP server configurations
- Usage examples
- Best practices

## Available Agents

- **[`code-reviewer`](./code-reviewer/)**: An agent specialized in reviewing code, finding bugs, security vulnerabilities, and suggesting improvements. For detailed setup and usage, see the [`code-reviewer/README.md`](./code-reviewer/README.md).
- **[`deepest-thinking`](./deepest-thinking/)**: An agent specialized in performing deep research and analysis. For detailed setup and usage, see the [`deepest-thinking/README.md`](./deepest-thinking/README.md).
- **[`fullstack-builder`](./fullstack-builder/)**: An agent designed to build complete fullstack applications from scratch or extend existing projects. For detailed setup and usage, see the [`fullstack-builder/README.md`](./fullstack-builder/README.md).
- **[`normal-chat-agent`](./normal-chat-agent/)**: A standard Trae agent for general pair programming and coding assistance. For more details, see the [`normal-chat-agent/README.md`](./normal-chat-agent/README.md).
- **[`planner-agent`](./planner-agent/)**: An agent designed for planning and breaking down complex tasks. For detailed setup and usage, see the [`planner-agent/README.md`](./planner-agent/README.md).
- **[`performance-accessibility-expert`](./performance-accessibility-expert/)**: An agent specialized in performance optimization, accessibility compliance, and security best practices. For detailed setup and usage, see the [`performance-accessibility-expert/README.md`](./performance-accessibility-expert/README.md).
- **[`refactoring-expert`](./refactoring-expert/)**: An agent focused on refactoring and improving existing codebases. For detailed setup and usage, see the [`refactoring-expert/README.md`](./refactoring-expert/README.md).

## Creating Your Own Agent

To create a custom agent in Trae IDE:

1. Click the Settings icon > Agents, or click @Agent > + Create Agent in the input box
2. Click the + Create Agent button
3. Configure your agent with a name, prompt, and tools
4. Save your configuration

Feel free to use these examples as inspiration for your own custom agents!
