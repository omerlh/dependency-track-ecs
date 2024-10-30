import type { Construct } from 'constructs';
import { TerraformStack, DataTerraformRemoteState, RemoteBackend, App } from 'cdktf';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider/index';
import { ecs } from './ecs';

export class Stack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);

    new RemoteBackend(scope, {
      hostname: 'app.terraform.io',
      organization: 'missing',
      workspaces: {
        name: 'missing',
      },
    });

    new AwsProvider(scope, 'AWS', {
      region: '',
      allowedAccountIds: ['missing'],
      defaultTags: [
        {
          tags: {},
        },
      ],
    });
    const vpcId = 'missing';
    const privateSubnets = ['missing'];
    const zoneId = 'missing';
    ecs(this, vpcId, privateSubnets, zoneId);
  }
}

const app = new App();
new Stack(app, 'main');
app.synth();
