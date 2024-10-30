/* eslint-disable @typescript-eslint/naming-convention */
import { readFileSync } from 'node:fs';
import type { Construct } from 'constructs';
import { Fn } from 'cdktf';
import { EcsCluster } from '../.gen/modules/ecs-cluster';
import { EcsService } from '../.gen/modules/ecs-service';
import { Alb } from '../.gen/modules/alb';

const version = '4.11.5';

export const ecs = (scope: Construct, vpcId: string, subnetIds: string[], zoneId: string) => {
  const configFile = readFileSync('./fixtures/logback.xml', 'base64');

  const cluster = new EcsCluster(scope, 'dependency-track-cluster', {
    clusterName: 'dependency-track',
    fargateCapacityProviders: {
      FARGATE_SPOT: {
        default_capacity_provider_strategy: {
          weight: 100,
        },
      },
    },
    cloudwatchLogGroupName: 'dependency_track',
    cloudwatchLogGroupRetentionInDays: 1,
  });

  const alb = new Alb(scope, 'dependency-track-alb', {
    internal: true,
    name: 'dependency-track',
    loadBalancerType: 'application',
    vpcId,
    subnets: subnetIds,
    enableDeletionProtection: false,
    securityGroupIngressRules: {
      all_http: {
        from_port: 80,
        to_port: 80,
        ip_protocol: 'tcp',
        cidr_ipv4: '0.0.0.0/0',
      },
      all_https: {
        from_port: 443,
        to_port: 443,
        ip_protocol: 'tcp',
        cidr_ipv4: '0.0.0.0/0',
      },
    },
    listeners: {
      http: {
        port: 80,
        protocol: 'HTTP',
        redirect: {
          port: '443',
          protocol: 'HTTPS',
          status_code: 'HTTP_301',
        },
      },
      https: {
        port: 443,
        protocol: 'HTTPS',
        ssl_policy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
        certificate_arn: '<valid certificate for your domain>',
        fixed_response: {
          content_type: 'text/plain',
          message_body: 'Not found',
          status_code: '404',
        },
        rules: {
          api: {
            priority: 1,
            actions: [
              {
                type: 'forward',
                target_group_key: 'apiServer',
              },
            ],
            conditions: [
              {
                path_pattern: {
                  values: ['/api/*'],
                },
              },
            ],
          },
          mirror: {
            priority: 2,
            actions: [
              {
                type: 'forward',
                target_group_key: 'apiServer',
              },
            ],
            conditions: [
              {
                path_pattern: {
                  values: ['/mirror/*'],
                },
              },
            ],
          },
          ui: {
            priority: 3,
            actions: [
              {
                type: 'forward',
                target_group_key: 'ui',
              },
            ],
            conditions: [
              {
                path_pattern: {
                  values: ['/*'],
                },
              },
            ],
          },
        },
      },
    },
    targetGroups: {
      apiServer: {
        backend_protocol: 'HTTP',
        backend_port: 8080,
        target_type: 'ip',
        deregistration_delay: 5,
        load_balancing_cross_zone_enabled: true,

        health_check: {
          enabled: true,
          healthy_threshold: 5,
          interval: 30,
          matcher: '200',
          path: '/api/version',
          port: 'traffic-port',
          protocol: 'HTTP',
          timeout: 5,
          unhealthy_threshold: 2,
        },
        create_attachment: false,
      },
      ui: {
        backend_protocol: 'HTTP',
        backend_port: 8080,
        target_type: 'ip',
        deregistration_delay: 5,
        load_balancing_cross_zone_enabled: true,

        health_check: {
          enabled: true,
          healthy_threshold: 5,
          interval: 30,
          matcher: '200',
          path: '/',
          port: 'traffic-port',
          protocol: 'HTTP',
          timeout: 5,
          unhealthy_threshold: 2,
        },
        create_attachment: false,
      },
    },
    route53Records: {
      A: {
        name: 'missing',
        type: 'A',
        zone_id: zoneId,
      },
      AAAA: {
        name: 'missing',
        type: 'AAAA',
        zone_id: zoneId,
      },
    },
  });

  new EcsService(scope, 'dependency-track-service', {
    clusterArn: cluster.arnOutput,
    name: 'dependency-track',
    cpu: 4 * 1024,
    memory: 8 * 1024,
    enableExecuteCommand: false,
    enableAutoscaling: false,
    desiredCount: 1,
    launchType: 'FARGATE',
    subnetIds,
    taskExecSecretArns: ['missing'], // /secret containing postgres credentials
    volume: [
      {
        name: 'config',
        host: {},
      },
      {
        name: 'data',
        host: {},
      },
      {
        name: 'tmp',
        host: {},
      },
    ],
    containerDefinitions: {
      init: {
        image: '<your ecr proxy url>/docker-hub/library/busybox:stable',
        essential: false,
        command: ['sh', '-c', 'echo $DATA | base64 -d - | tee /etc/dependencytrack/logback.xml'],
        environment: [
          {
            name: 'DATA',
            value: Fn.rawString(configFile),
          },
        ],
        mount_points: [
          {
            containerPath: '/etc/dependencytrack',
            sourceVolume: 'config',
          },
        ],
      },
      api: {
        cloudwatchLogGroupName: 'dependency_track_container',
        cloudwatchLogGroupRetentionInDays: 1,
        cpu: 4 * 1024,
        memory: 8 * 1024,
        essential: true,
        image: `<your ecr proxy url>/docker-hub/dependencytrack/apiserver:${version}`,
        mount_points: [
          {
            containerPath: '/etc/dependencytrack',
            sourceVolume: 'config',
          },
          {
            containerPath: '/data',
            sourceVolume: 'data',
          },
          {
            containerPath: '/tmpFolder',
            sourceVolume: 'tmp',
          },
        ],
        dependencies: [
          {
            condition: 'COMPLETE',
            containerName: 'init',
          },
        ],
        port_mappings: [
          {
            name: 'http',
            containerPort: 8080,
            protocol: 'tcp',
          },
        ],
        secrets: [
          {
            name: 'ALPINE_DATABASE_PASSWORD',
            valueFrom: 'missing', // postgres password name
          },
        ],
        environment: [
          {
            name: 'EXTRA_JAVA_OPTIONS',
            value: '-Djava.io.tmpdir=/tmpFolder',
          },
          {
            name: 'LOGGING_CONFIG_PATH',
            value: '/etc/dependencytrack/logback.xml',
          },
          {
            name: 'ALPINE_DATA_DIRECTORY',
            value: '/data',
          },
          {
            name: 'ALPINE_OIDC_ENABLED',
            value: 'true',
          },
          {
            name: 'ALPINE_OIDC_CLIENT_ID',
            value: '<see dependency track documentation>',
          },
          {
            name: 'ALPINE_OIDC_ISSUER',
            value: '<see dependency track documentation>',
          },
          {
            name: 'ALPINE_OIDC_USERNANE_CLAIM',
            value: '<see dependency track documentation>',
          },
          {
            name: 'ALPINE_OIDC_USER_PROVISIONING',
            value: '<see dependency track documentation>',
          },
          {
            name: 'ALPINE_DATABASE_MODE',
            value: 'external',
          },
          {
            name: 'ALPINE_DATABASE_DRIVER',
            value: 'org.postgresql.Driver',
          },
          {
            name: 'ALPINE_DATABASE_URL',
            value: '<rds url>',
          },
          {
            name: 'ALPINE_DATABASE_USERNAME',
            value: '<rds user name>',
          },
        ],
      },
    },
    loadBalancer: {
      api: {
        target_group_arn: Fn.lookup(Fn.lookup(alb.targetGroupsOutput, 'apiServer', 'missing'), 'arn', 'missing'),
        container_name: 'api',
        container_port: 8080,
      },
    },
    securityGroupRules: {
      alb_ingress: {
        type: 'ingress',
        from_port: 8080,
        to_port: 8080,
        protocol: 'tcp',
        description: 'service port',
        source_security_group_id: alb.securityGroupIdOutput,
      },
      egress_all: {
        type: 'egress',
        from_port: 0,
        to_port: 0,
        protocol: '-1',
        cidr_blocks: ['0.0.0.0/0'],
      },
    },
  });

  new EcsService(scope, 'dependency-track-ui', {
    clusterArn: cluster.arnOutput,
    name: 'dependency-track-ui',
    cpu: 256,
    memory: 512,
    enableExecuteCommand: false,
    enableAutoscaling: false,
    desiredCount: 1,
    launchType: 'FARGATE',
    subnetIds,
    volume: [
      {
        name: 'tmp',
        host: {},
      },
    ],
    containerDefinitions: {
      ui: {
        cpu: 1,
        memory: 256,
        essential: true,
        image: `<your ecr proxy url>/docker-hub/dependencytrack/frontend:${version}`,
        readonly_root_filesystem: false,
        mount_points: [
          {
            containerPath: '/tmp',
            sourceVolume: 'tmp',
          },
        ],
        environment: [
          {
            name: 'API_BASE_URL',
            value: 'the DNS you set',
          },
          {
            name: 'OIDC_CLIENT_ID',
            value: '<see the relevant docs>',
          },
          {
            name: 'OIDC_ISSUER',
            value: '<see the relevant docs>',
          },
          {
            name: 'OIDC_FLOW',
            value: 'implicit',
          },
        ],
        port_mappings: [
          {
            name: 'ui',
            containerPort: 8080,
            protocol: 'tcp',
          },
        ],
      },
    },
    loadBalancer: {
      ui: {
        target_group_arn: Fn.lookup(Fn.lookup(alb.targetGroupsOutput, 'ui', 'missing'), 'arn', 'missing'),
        container_name: 'ui',
        container_port: 8080,
      },
    },
    securityGroupRules: {
      alb_ingress: {
        type: 'ingress',
        from_port: 8080,
        to_port: 8080,
        protocol: 'tcp',
        description: 'service port',
        source_security_group_id: alb.securityGroupIdOutput,
      },
      egress_all: {
        type: 'egress',
        from_port: 0,
        to_port: 0,
        protocol: '-1',
        cidr_blocks: ['0.0.0.0/0'],
      },
    },
  });
};
