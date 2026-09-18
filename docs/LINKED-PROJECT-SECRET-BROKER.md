# Linked-Project Secret Broker

CoOperative separates reasoning, approval, credential entry, environment mutation, and deployment.

## Security boundary

A provider/environment value is never accepted until the owner has approved a Decision Brief that names the exact linked project, environment-variable key, and target environment.

The value is then submitted once to a server-only endpoint. CoOperative validates the approved scope, obtains its Vercel API credential at runtime through a Vercel Connect API-key connector using deployment OIDC, and performs one allow-listed environment-variable upsert.

The secret value is not written to:

- CoOperative database tables
- task descriptions or Decision Briefs
- GitHub
- Hermes prompts or tool context
- task events or cost ledger
- application logs by CoOperative code

The broker response stores only project, key, target, provider, timestamp, and boolean audit facts.

## One-time Vercel setup

The owner creates a team-scoped Vercel access token with the permissions required to manage the linked projects, stores that token in a Vercel Connect API-key connector, and attaches the connector to CoOperative. CoOperative stores only the connector UID in `COOPERATIVE_VERCEL_ADMIN_CONNECTOR`.

At runtime CoOperative authenticates to Vercel Connect with its deployment OIDC identity and asks for the connector credential only for the approved server-side action.

## Deployment remains separate

Writing or replacing an environment variable does not redeploy CreatorHub or RaiseHub. Preview/production deployment remains a separate governed action. This prevents a credential setup step from silently changing live application behavior.
