import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';

export class TechhealthMigrationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

// Create public and isolated database subnets across two Availability Zones.
// No NAT Gateways are deployed; database subnets have no internet default route.

    const vpc = new ec2.Vpc(this, 'TechHealthVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Database',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });
    const ec2SecurityGroup = new ec2.SecurityGroup(this, 'Ec2SecurityGroup', {
      vpc,
      description: 'Shared security group for both TechHealth EC2 instances',
    });
    const rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc,
      description: 'Allows MySQL connections from TechHealth EC2 instances',
    });

// Allow MySQL connections only from instances using the shared EC2 security group.
// No internet-wide inbound database access is permitted.

    rdsSecurityGroup.addIngressRule(
      ec2SecurityGroup,
      ec2.Port.tcp(3306),
      'Allow MySQL from the shared EC2 security group',
    );
// Both EC2 instances share this role for Systems Manager administration.
// Session Manager lets us connect without opening an inbound SSH port.

    const ec2Role = new iam.Role(this, 'Ec2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    ec2Role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
    );

// Place one application instance in each Availability Zone's public subnet.
// Both instances use the same security group and Systems Manager role.

   const appServerA = new ec2.Instance(this, 'AppServerA', {
      vpc,
      vpcSubnets: { subnets: [vpc.publicSubnets[0]] },
      instanceType: new ec2.InstanceType('t2.micro'),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: ec2SecurityGroup,
      role: ec2Role,
      associatePublicIpAddress: true,
    });
  // Install the MySQL client automatically when this instance first starts.
    appServerA.addUserData(
    'dnf install -y mariadb105',
);
    const appServerB = new ec2.Instance(this, 'AppServerB', {
      vpc,
      vpcSubnets: { subnets: [vpc.publicSubnets[1]] },
      instanceType: new ec2.InstanceType('t2.micro'),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: ec2SecurityGroup,
      role: ec2Role,
      associatePublicIpAddress: true,
    });
    // Install the MySQL client automatically when this instance first starts.
    appServerB.addUserData(
    'dnf install -y mariadb105',
);
// Include isolated subnets from both Availability Zones in the DB subnet group.
// The Single-AZ database runs in one subnet selected by RDS.

    const dbSubnetGroup = new rds.SubnetGroup(this, 'DatabaseSubnetGroup', {
      vpc,
      description: 'Isolated subnets for the TechHealth database',
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });
// Create an encrypted Single-AZ MySQL database with public access disabled.
// Generate credentials in Secrets Manager instead of hardcoding a password.
// Lab only: destroying the stack deletes the database without a final snapshot.
    
    new rds.DatabaseInstance(this, 'TechHealthDatabase', {
      vpc,
      subnetGroup: dbSubnetGroup,
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0_46,
    }),
    instanceType: new ec2.InstanceType('t3.micro'),
    securityGroups: [rdsSecurityGroup],
    credentials: rds.Credentials.fromGeneratedSecret('labadmin'),
    allocatedStorage: 20,
    storageEncrypted: true,
    publiclyAccessible: false,
    multiAz: false,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
   });
  }
}