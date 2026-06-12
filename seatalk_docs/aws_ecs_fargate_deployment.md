# AWS ECS Fargate UI Deployment Guide

This guide deploys the SeaTalk callback server to AWS using the AWS Console as much as possible.

Target callback URL:

```text
https://seatalk.soc5outboundops.app/seatalk/callback
```

Architecture:

```text
SeaTalk -> Cloudflare DNS -> AWS Application Load Balancer -> ECS Fargate task
```

AWS services used:

- Amazon ECR for the Docker image
- Amazon ECS Fargate for the container
- Application Load Balancer for public HTTP/HTTPS
- AWS Certificate Manager for TLS
- AWS Secrets Manager for bot and Google credentials
- CloudWatch Logs for container logs
- Cloudflare DNS for `seatalk.soc5outboundops.app`

Recommended region:

```text
ap-southeast-1
```

## Before You Start

Have these ready:

- AWS account access for ECR, ECS, EC2 load balancing, ACM, IAM, CloudWatch Logs, and Secrets Manager
- Docker Desktop installed locally
- AWS CLI configured locally, only for pushing the Docker image to ECR
- Cloudflare DNS access for `soc5outboundops.app`
- Google service account JSON from `credentials/google-service-account.json`
- SeaTalk bot credentials from `credentials/bot_credentials`
- Google Sheet shared with the service account email as Editor

The sheet target is:

```text
Sheet ID: 1BgorYmizHGxOzzauLxSL_uu8WSybQYjvtSnbCeZjLf8
Tab: bot_groupid
```

## Step 1: Create ECR Repository

In the AWS Console:

1. Open **Amazon ECR**.
2. Click **Create repository**.
3. Choose **Private**.
4. Repository name:

```text
soc11-seatalk-callback
```

5. Leave the remaining defaults.
6. Click **Create repository**.

Open the repository and click **View push commands**. Keep that modal open or copy the commands.

Build and push from this repo root using the commands AWS shows. The commands will look like this:

```powershell
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com
docker build -t soc11-seatalk-callback .
docker tag soc11-seatalk-callback:latest <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/soc11-seatalk-callback:latest
docker push <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/soc11-seatalk-callback:latest
```

After the push finishes, refresh the ECR repository and confirm the `latest` image exists.

## Step 2: Create Secrets

Open **AWS Secrets Manager** in `ap-southeast-1`.

### Google Service Account Secret

1. Click **Store a new secret**.
2. Secret type: **Other type of secret**.
3. Choose **Plaintext**.
4. Paste the full JSON contents of:

```text
credentials/google-service-account.json
```

5. Click **Next**.
6. Secret name:

```text
soc11/google-service-account-json
```

7. Keep default encryption unless your AWS environment requires a custom KMS key.
8. Click through and store the secret.

### Bot Credentials Secret

Create another secret.

1. Secret type: **Other type of secret**.
2. Choose **Plaintext**.
3. Paste a JSON array like this:

```json
[
  {
    "bot_name": "SOC_11_Bot_Reporter",
    "app_id": "<app_id>",
    "app_secret": "<app_secret>",
    "signing_secret": "<signing_secret>",
    "bot_description": "SOC 11 Bot Reporter"
  },
  {
    "bot_name": "SOC11_Recovery_Reports",
    "app_id": "<app_id>",
    "app_secret": "<app_secret>",
    "signing_secret": "<signing_secret>",
    "bot_description": "SOC11 Recovery Reports"
  }
]
```

4. Secret name:

```text
soc11/bot-credentials-json
```

5. Store the secret.

Do not paste these secrets into the ECS environment variable section as plain text. Use ECS **Secrets** mapping later.

## Step 3: Request TLS Certificate

Open **AWS Certificate Manager** in `ap-southeast-1`.

1. Click **Request certificate**.
2. Choose **Request a public certificate**.
3. Fully qualified domain name:

```text
seatalk.soc5outboundops.app
```

4. Validation method: **DNS validation**.
5. Click **Request**.

Open the certificate details. ACM will show a CNAME validation record.

In Cloudflare:

1. Open the `soc5outboundops.app` zone.
2. Go to **DNS** > **Records**.
3. Add the ACM validation CNAME.
4. Set **Proxy status** to **DNS only** for the validation record.
5. Save it.

Wait until ACM status becomes **Issued**. Keep this validation CNAME so the certificate can renew.

## Step 4: Create Security Groups

Open **EC2** > **Security Groups**.

Create the ALB security group:

```text
Name: soc11-seatalk-alb-sg
Description: Public access to SeaTalk callback ALB
VPC: default VPC or your selected production VPC
```

Inbound rules:

```text
HTTP   TCP 80   Source 0.0.0.0/0
HTTPS  TCP 443  Source 0.0.0.0/0
```

Outbound rules:

```text
All traffic
```

Create the ECS task security group:

```text
Name: soc11-seatalk-task-sg
Description: Allow ALB to reach SeaTalk callback container
VPC: same VPC as ALB
```

Inbound rule:

```text
Custom TCP  TCP 8000  Source soc11-seatalk-alb-sg
```

Outbound rules:

```text
All traffic
```

## Step 5: Create Target Group

Open **EC2** > **Target Groups**.

1. Click **Create target group**.
2. Target type: **IP addresses**.
3. Name:

```text
soc11-seatalk-tg
```

4. Protocol: **HTTP**.
5. Port: `8000`.
6. VPC: same VPC as the security groups.
7. Health check path:

```text
/healthz
```

8. Success codes: `200`.
9. Do not register targets manually.
10. Create the target group.

ECS will register task IPs later.

## Step 6: Create Application Load Balancer

Open **EC2** > **Load Balancers**.

1. Click **Create load balancer**.
2. Choose **Application Load Balancer**.
3. Name:

```text
soc11-seatalk-alb
```

4. Scheme: **Internet-facing**.
5. IP address type: **IPv4**.
6. VPC: same VPC used above.
7. Select at least two public subnets.
8. Security group: `soc11-seatalk-alb-sg`.

Listeners:

```text
HTTP 80
HTTPS 443
```

For the HTTPS listener:

1. Select the ACM certificate for `seatalk.soc5outboundops.app`.
2. Default action: forward to `soc11-seatalk-tg`.

After the ALB is created:

1. Open the HTTP `:80` listener.
2. Edit the default action.
3. Change it to **Redirect to URL**.
4. Protocol: `HTTPS`.
5. Port: `443`.
6. Status code: `HTTP_301`.

Copy the ALB DNS name. It looks like:

```text
soc11-seatalk-alb-123456789.ap-southeast-1.elb.amazonaws.com
```

## Step 7: Create ECS Cluster

Open **Amazon ECS** > **Clusters**.

1. Click **Create cluster**.
2. Cluster name:

```text
soc11-seatalk
```

3. Infrastructure: **AWS Fargate serverless**.
4. Create the cluster.

## Step 8: Create Task Execution Role

Open **IAM** > **Roles**.

If `ecsTaskExecutionRole` already exists, open it. Otherwise:

1. Click **Create role**.
2. Trusted entity type: **AWS service**.
3. Use case: **Elastic Container Service Task**.
4. Add permission policy:

```text
AmazonECSTaskExecutionRolePolicy
```

5. Role name:

```text
ecsTaskExecutionRole
```

Add an inline policy to the role:

1. Open the role.
2. Click **Add permissions** > **Create inline policy**.
3. Choose **JSON**.
4. Paste this, replacing `<account-id>`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": [
        "arn:aws:secretsmanager:ap-southeast-1:<account-id>:secret:soc11/google-service-account-json*",
        "arn:aws:secretsmanager:ap-southeast-1:<account-id>:secret:soc11/bot-credentials-json*"
      ]
    }
  ]
}
```

5. Policy name:

```text
soc11-seatalk-read-secrets
```

6. Save it.

## Step 9: Create Task Definition

Open **Amazon ECS** > **Task definitions**.

1. Click **Create new task definition**.
2. Task definition family:

```text
soc11-seatalk-callback
```

3. Launch type: **AWS Fargate**.
4. Operating system/architecture: **Linux/X86_64**.
5. CPU: `.25 vCPU`.
6. Memory: `.5 GB`.
7. Task execution role: `ecsTaskExecutionRole`.

Container settings:

```text
Name: soc11-seatalk-callback
Image URI: <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/soc11-seatalk-callback:latest
Container port: 8000
Protocol: TCP
```

Environment variables:

```text
PORT=8000
SHEET_ID=1BgorYmizHGxOzzauLxSL_uu8WSybQYjvtSnbCeZjLf8
SHEET_TAB_NAME=bot_groupid
SEATALK_REQUIRE_SIGNATURE=true
LOG_LEVEL=INFO
```

Secrets:

```text
GOOGLE_SERVICE_ACCOUNT_JSON = soc11/google-service-account-json
BOT_CREDENTIALS_JSON = soc11/bot-credentials-json
```

Logging:

```text
Log collection: Use awslogs
Log group: /ecs/soc11-seatalk-callback
Region: ap-southeast-1
Stream prefix: ecs
```

Create the task definition.

## Step 10: Create ECS Service

Open **Amazon ECS** > **Clusters** > `soc11-seatalk`.

1. Click **Create** under Services.
2. Compute options: **Launch type**.
3. Launch type: **Fargate**.
4. Task definition family: `soc11-seatalk-callback`.
5. Revision: latest.
6. Service name:

```text
soc11-seatalk-callback-service
```

7. Desired tasks: `1`.

Networking:

```text
VPC: same VPC as ALB
Subnets: public subnets
Security group: soc11-seatalk-task-sg
Public IP: Enabled
```

Load balancing:

```text
Load balancer type: Application Load Balancer
Use an existing load balancer: soc11-seatalk-alb
Listener: HTTPS:443
Target group: soc11-seatalk-tg
Container: soc11-seatalk-callback
Port: 8000
```

Create the service.

Wait for:

```text
ECS service desired: 1
ECS service running: 1
Target group health: healthy
```

## Step 11: Point Cloudflare DNS to ALB

Open Cloudflare DNS for `soc5outboundops.app`.

Create:

```text
Type: CNAME
Name: seatalk
Target: <your-alb-dns-name>
Proxy status: DNS only
TTL: Auto
```

Use **DNS only** first while validating AWS HTTPS. After everything works, you may test **Proxied** mode if needed.

Open:

```text
https://seatalk.soc5outboundops.app/healthz
```

Expected response:

```json
{
  "configured_bots": 2,
  "google_service_account_configured": true,
  "sheet_id": "1BgorYmizHGxOzzauLxSL_uu8WSybQYjvtSnbCeZjLf8",
  "sheet_tab": "bot_groupid",
  "status": "ok"
}
```

## Step 12: Configure SeaTalk Callback

In SeaTalk Open Platform:

1. Open the bot app.
2. Go to **Event Callback**.
3. Set callback URL:

```text
https://seatalk.soc5outboundops.app/seatalk/callback
```

4. Save and let SeaTalk run callback verification.

After verification succeeds, add the bot to a group chat. The server handles `bot_added_to_group_chat` and writes to:

```text
Sheet ID: 1BgorYmizHGxOzzauLxSL_uu8WSybQYjvtSnbCeZjLf8
Tab: bot_groupid
Columns: bot_name, app_id, app_secret, signing_secret, group_id, group_name, is_active, bot_description
```

## Updating the App Later

Use the ECR repository page:

1. Open **Amazon ECR**.
2. Open `soc11-seatalk-callback`.
3. Click **View push commands**.
4. Run the generated build, tag, and push commands from the repo root.

Then redeploy in ECS:

1. Open **Amazon ECS** > **Clusters** > `soc11-seatalk`.
2. Open `soc11-seatalk-callback-service`.
3. Click **Update service**.
4. Enable **Force new deployment**.
5. Save.

ECS will pull the new `latest` image and replace the running task.

## Troubleshooting

### Health Check Does Not Open

Check:

- Cloudflare CNAME points to the ALB DNS name.
- Cloudflare record is `DNS only` during initial testing.
- ALB has an HTTPS listener on `443`.
- ACM certificate is `Issued`.
- Target group has one healthy target.

### Target Group Is Unhealthy

Check:

- Target type is `IP addresses`.
- Health check path is `/healthz`.
- Health check success code is `200`.
- Target group port is `8000`.
- ECS task security group allows TCP `8000` from the ALB security group.
- Container port mapping is `8000`.

### ECS Task Stops Immediately

Open **CloudWatch Logs**:

```text
/ecs/soc11-seatalk-callback
```

Common causes:

- wrong ECR image URI
- `PORT=8000` missing
- invalid JSON in Secrets Manager
- task execution role cannot read Secrets Manager
- task execution role cannot pull from ECR

### `/healthz` Shows `configured_bots: 0`

Check ECS task definition **Secrets**:

```text
BOT_CREDENTIALS_JSON = soc11/bot-credentials-json
```

The secret value must be a JSON object or array containing `app_id`, `app_secret`, and `signing_secret`.

### `/healthz` Shows `google_service_account_configured: false`

Check ECS task definition **Secrets**:

```text
GOOGLE_SERVICE_ACCOUNT_JSON = soc11/google-service-account-json
```

The secret value must be the full Google service account JSON object.

### ACM Certificate Stays Pending

Check the Cloudflare ACM validation CNAME:

- It must be `DNS only`.
- The name and value must match ACM exactly.
- Do not create it as an A record.
- Do not delete it after validation.

### SeaTalk Callback Verification Fails

Check:

- callback URL is exactly `https://seatalk.soc5outboundops.app/seatalk/callback`
- `/healthz` works over HTTPS
- SeaTalk `app_id` exists in `BOT_CREDENTIALS_JSON`
- SeaTalk callback signing secret matches `signing_secret`
- `SEATALK_REQUIRE_SIGNATURE=true`

## References

- ECS secrets injection: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html
- ECS service load balancing: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html
- ECR Docker push flow: https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html
- ACM DNS validation: https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html
