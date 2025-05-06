# Turbo Remote Cache

This application implements a remote cache server for [Turborepo](https://turbo.build/repo/docs/core-concepts/remote-caching).

Based heavily on https://github.com/EloB/turborepo-remote-cache-lambda

## Architecture

- An S3 bucket to store build artifacts
- A Lambda function to handle authentication and generate pre-signed S3 URLs
- An HTTP API Gateway to expose the Lambda function

The Lambda function authenticates requests using JWT and generates pre-signed URLs allowing direct upload/download to/from S3. This approach bypasses Lambda payload size limits.

## Deployment

The application is deployed using AWS CDK. The stack creates all necessary resources with appropriate permissions.

```bash
# Deploy to dev environment
npx cdk deploy TurboCacheStack --profile your-profile
```

## JWT Authentication

### Generating a Secret

```bash
# Using OpenSSL
openssl rand -base64 32

# or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Get this value to the `JWT_SECRET` environment variable in the stack.

### Creating a JWT Token

To create a valid JWT token for authentication:

1. Visit [jwt.io](https://jwt.io/)
2. In the payload section, add a `teamId` claim:
   ```json
   {
     "teamId": "team_yourteamid",
   }
   ```
   Note: The `teamId` must start with `team_` and contain alphanumeric characters.

3. In the "Verify Signature" section:
   - Paste your JWT secret generated above
   - Leave the "secret base64 encoded" checkbox UNCHECKED

4. Copy the generated token from the left panel

## Using with Turborepo

Configure Turborepo to use your remote cache:

In your `turbo.json`:
```json
{
  "remoteCache": {
		"enabled": true,
		"apiUrl": "https://abc123.execute-api.eu-north-1.amazonaws.com",
		"teamId": "team_yourTeam",
		"preflight": true
  }
}
```

And then make sure that you have your token available:
```bash
export TURBO_TOKEN="your-jwt-token"
```

### Preflight Flag for Remote Cache

The [`preflight`](https://turborepo.com/docs/reference/configuration#preflight) flag is essential as it enables Turborepo to send OPTIONS requests before actual uploads/downloads. These OPTIONS requests are necessary for our implementation to return the correct presigned S3 URLs.

To run tasks with Turborepo:
```bash
npx turbo run build
```

To verify connectivity without running tasks:
```bash
npx turbo run build --dry-run
```
