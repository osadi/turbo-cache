import * as cdk from 'aws-cdk-lib';
import * as httpApi from 'aws-cdk-lib/aws-apigatewayv2';
import * as httpIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export interface TurboCacheStackProps extends cdk.StackProps {
	readonly lambdaProps?: Record<string, unknown>;
}

export class TurboCacheStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: TurboCacheStackProps) {
		super(scope, id, props);

		// S3 bucket for TurboRepo remote cache
		const turboCacheBucket = new s3.Bucket(this, 'TurboRepoCacheBucket', {
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			autoDeleteObjects: true,
			versioned: false,
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
			lifecycleRules: [
				{
					expiration: cdk.Duration.days(7),
				},
			],
			cors: [
				{
					allowedHeaders: [],
					allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
					allowedOrigins: ['*'],
					exposedHeaders: [],
				},
			],
		});

		const turboCacheHandler = new NodejsFunction(
			this,
			'TurboRepoCacheHandler',
			{
				functionName: 'turbo-cache',
				description: 'TurboRepo remote cache handler',
				entry: './src/handler.ts',
				handler: 'handler',
				timeout: cdk.Duration.seconds(3),
				environment: {
					JWT_SECRET: 'replace-me', // Set via context/SSM/SecretsManager as needed
					S3_BUCKET: turboCacheBucket.bucketName,
				},
				...props?.lambdaProps,
			},
		);
		turboCacheBucket.grantReadWrite(turboCacheHandler);

		const lambdaIntegration = new httpIntegrations.HttpLambdaIntegration(
			'TurboCacheLambdaIntegration',
			turboCacheHandler,
		);

		// HTTP API (APIGatewayV2)
		const api = new httpApi.HttpApi(this, 'TurboRepoRemoteCacheApi', {
			apiName: 'turbo-cache-api',
			createDefaultStage: true,
			defaultIntegration: lambdaIntegration,
		});

		// Add routes for root path and catch-all proxy
		api.addRoutes({
			path: '/',
			methods: [httpApi.HttpMethod.ANY],
			integration: lambdaIntegration,
		});

		api.addRoutes({
			path: '/{proxy+}',
			methods: [httpApi.HttpMethod.ANY],
			integration: lambdaIntegration,
		});

		new cdk.CfnOutput(this, 'TurboRepoRemoteCacheApiUrl', {
			// biome-ignore lint/style/noNonNullAssertion: `createDefaultStage` is set to true above
			value: api.url!,
		});
		new cdk.CfnOutput(this, 'TurboRepoRemoteCacheFunctionArn', {
			value: turboCacheHandler.functionArn,
		});
		new cdk.CfnOutput(this, 'TurboRepoRemoteCacheBucketName', {
			value: turboCacheBucket.bucketName,
		});
	}
}
