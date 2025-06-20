import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { Hono } from 'hono'
import { Octokit } from 'octokit'
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl, Props } from './oauth'
import { env } from 'cloudflare:workers'
import { clientIdAlreadyApproved, parseRedirectApproval, renderApprovalDialog } from './workers-oauth-utils'

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>()

app.get('/authorize', async (c) => {
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw)
	const { clientId } = oauthReqInfo
	if (!clientId) {
		return c.text('Invalid request', 400)
	}

	if (await clientIdAlreadyApproved(c.req.raw, oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
		return redirectToGithub(c.req.raw, oauthReqInfo, c.env.GITHUB_CLIENT_ID)
	}

	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		server: {
			provider: "github",
			name: 'Context4all',
            logo: "https://avatars.githubusercontent.com/u/314135?s=200&v=4",
            description: 'An MCP (Model Context Protocol) server for indexing information and generating precise context for LLM models to enhance AI response quality.',
		},
		state: { oauthReqInfo }, // arbitrary data that flows through the form submission below
	})
})

app.post('/authorize', async (c) => {
	// Validates form submission, extracts state, and generates Set-Cookie headers to skip approval dialog next time
	const { state, headers } = await parseRedirectApproval(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY)
	if (!state.oauthReqInfo) {
		return c.text('Invalid request', 400)
	}

	return redirectToGithub(c.req.raw, state.oauthReqInfo, c.env.GITHUB_CLIENT_ID, headers)
})

async function redirectToGithub(request: Request, oauthReqInfo: AuthRequest, githubClientId: string, headers: Record<string, string> = {}) {
	return new Response(null, {
		status: 302,
		headers: {
			...headers,
			location: getUpstreamAuthorizeUrl({
				upstream_url: 'https://github.com/login/oauth/authorize',
				scope: 'read:user',
				client_id: githubClientId,
				redirect_uri: new URL('/callback/github', request.url).href,
				state: btoa(JSON.stringify(oauthReqInfo)),
			}),
		},
	})
}

/**
 * OAuth Callback Endpoint
 *
 * This route handles the callback from GitHub after user authentication.
 * It exchanges the temporary code for an access token, then stores some
 * user metadata & the auth token as part of the 'props' on the token passed
 * down to the client. It ends by redirecting the client back to _its_ callback URL
 */
app.get("/callback/github", async (c) => {
	// Get the oathReqInfo out of KV
	const oauthReqInfo = JSON.parse(atob(c.req.query("state") as string)) as AuthRequest;
	if (!oauthReqInfo.clientId) {
		return c.text("Invalid state", 400);
	}

	// Exchange the code for an access token
	const [accessToken, errResponse] = await fetchUpstreamAuthToken({
		upstream_url: "https://github.com/login/oauth/access_token",
		client_id: c.env.GITHUB_CLIENT_ID,
		client_secret: c.env.GITHUB_CLIENT_SECRET,
		code: c.req.query("code"),
		redirect_uri: new URL("/callback/github", c.req.url).href,
	});
	if (errResponse) return errResponse;

	// Fetch the user info from GitHub
	const user = await new Octokit({ auth: accessToken }).rest.users.getAuthenticated();
	const { login, name, email } = user.data;

	// Return back to the MCP client a new token
	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		request: oauthReqInfo,
		userId: login,
		metadata: {
			label: name,
		},
		scope: oauthReqInfo.scope,
		// This will be available on this.props inside MyMCP
		props: {
			login,
			name,
			email,
			accessToken,
			userEmail: email,
			userId: login,
		} as Props,
	});

	return Response.redirect(redirectTo);
});

export { app as GitHubHandler }
