import { S3RequestPresigner } from '@aws-sdk/s3-request-presigner';
import { formatUrl } from '@aws-sdk/util-format-url';
import { Hash } from '@smithy/hash-node';
import { HttpRequest } from '@smithy/protocol-http';
import { parseUrl } from '@smithy/url-parser';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { jwtVerify } from 'jose';

const UNAUTHORIZED = 'Unauthorized';

const notFound = () =>
	({
		statusCode: 404,
		body: 'Not found',
	}) as const;

const env = (key: string) => {
	const value = process.env[key];
	if (!value) {
		throw new Error(`Missing environment variable ${key}`);
	}
	return value;
};

const envDefault = <T>(key: string, fallback: T): string | T => {
	try {
		return env(key);
	} catch {}
	return fallback;
};

type TeamToken = { teamId: string };

function assertTeamToken(token: unknown): asserts token is TeamToken {
	// biome-ignore lint/suspicious/noExplicitAny: Cast to any to assert type
	const teamId = (token as any)?.teamId;
	if (typeof teamId !== 'string' || !/^team_\w+$/.test(teamId)) {
		throw new Error("Invalid token 'teamId'");
	}
}

const authenticate = (authorization: string) => {
	try {
		const token = jwtVerify(
			authorization.replace('Bearer ', ''),
			new TextEncoder().encode(env('JWT_SECRET')),
		);
		assertTeamToken(token);
		return token;
	} catch {
		throw new Error(UNAUTHORIZED);
	}
};

const generatePresignedUrl = async (
	method: 'GET' | 'PUT',
	region: string,
	bucket: string,
	key: string,
	teamId: string,
) => {
	const url = parseUrl(`https://${bucket}.s3.${region}.amazonaws.com/${key}`);
	const presigner = new S3RequestPresigner({
		credentials: {
			accessKeyId: env('AWS_ACCESS_KEY_ID'),
			secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
			sessionToken: envDefault('AWS_SESSION_TOKEN', undefined),
		},
		region,
		sha256: Hash.bind(null, 'sha256'),
	});
	const req = new HttpRequest({ ...url, method });
	req.query.teamId = teamId;
	const signedUrlObject = await presigner.presign(req, { expiresIn: 3600 });
	return formatUrl(signedUrlObject);
};

export const handler = async (event: APIGatewayProxyEventV2) => {
	const {
		rawPath,
		rawQueryString,
		requestContext: {
			http: { method: httpMethod },
		},
		headers: {
			authorization = '',
			'access-control-request-method': requestMethod,
			'x-forwarded-proto': protocol,
			host,
		},
	} = event;

	const location = new URL(
		`${protocol}://${host}${rawPath}${rawQueryString ? `?${rawQueryString}` : ''}`,
	);

	if (!location.pathname.startsWith('/v8/artifacts')) {
		return notFound();
	}

	switch (`${httpMethod}:${location.pathname}`) {
		case 'GET:/v8/artifacts/status':
			return {
				statusCode: 200,
				body: '{"enabled":true}',
			};
		case 'POST:/v8/artifacts/events':
			return {
				statusCode: 200,
				body: '{}',
			};
		default:
			try {
				const [, , , hash] = location.pathname.split('/');
				if (!hash || httpMethod !== 'OPTIONS') {
					return notFound();
				}
				const { teamId } = authenticate(authorization);
				const Key = `${teamId}/${hash}`;
				if (requestMethod === 'GET' || requestMethod === 'PUT') {
					return {
						statusCode: 200,
						headers: {
							location: await generatePresignedUrl(
								requestMethod,
								env('AWS_REGION'),
								env('S3_BUCKET'),
								Key,
								teamId,
							),
							'Access-Control-Allow-Origin': '*', // Or specific origin
							'Access-Control-Allow-Methods': 'PUT, GET, OPTIONS',
							'Access-Control-Allow-Headers':
								'Authorization, Content-Type, User-Agent, x-artifact-duration, x-artifact-tag',
						},
						body: '',
					} as const;
				}
				return notFound();
				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			} catch (e: any) {
				if (e.message !== UNAUTHORIZED) {
					throw e;
				}
				return {
					statusCode: 401,
					body: UNAUTHORIZED,
				};
			}
	}
};
