import { App } from 'aws-cdk-lib';
import { TurboCacheStack } from '../src/TurboCacheStack';

const app = new App();

new TurboCacheStack(app, 'TurboCacheStack');
