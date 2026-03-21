# Environment Variables Reference

## API (`apps/api/.env`)

### Required

| Variable       | Description                  | Example                                     |
| -------------- | ---------------------------- | ------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/hfp` |
| `NODE_ENV`     | Environment mode             | `development` / `production`                |
| `PORT`         | API server port              | `4000`                                      |

### Authentication (Keycloak)

| Variable             | Description       | Example                                                                 |
| -------------------- | ----------------- | ----------------------------------------------------------------------- |
| `KEYCLOAK_ISSUER`    | OIDC issuer URL   | `https://keycloak.example.com/realms/hfp`                               |
| `KEYCLOAK_JWKS_URI`  | JWKS endpoint     | `https://keycloak.example.com/realms/hfp/protocol/openid-connect/certs` |
| `KEYCLOAK_CLIENT_ID` | Client ID for API | `hfp-api`                                                               |

### Redis (BullMQ queues)

| Variable         | Description                       | Example                  |
| ---------------- | --------------------------------- | ------------------------ |
| `REDIS_URL`      | Full Redis URL (preferred)        | `redis://localhost:6379` |
| `REDIS_HOST`     | Redis hostname (if not using URL) | `127.0.0.1`              |
| `REDIS_PORT`     | Redis port                        | `6379`                   |
| `REDIS_PASSWORD` | Redis password                    | `secret`                 |

### Oracle OHIP (Opera Cloud / Simphony POS)

| Variable             | Description              | Example                           |
| -------------------- | ------------------------ | --------------------------------- |
| `OHIP_CLIENT_ID`     | OHIP OAuth client ID     | `abc123`                          |
| `OHIP_CLIENT_SECRET` | OHIP OAuth client secret | `secret`                          |
| `OHIP_ENTERPRISE_ID` | OHIP enterprise/hotel ID | `HOTEL001`                        |
| `OHIP_HOSTNAME`      | OHIP API base URL        | `https://ohipapi.oraclecloud.com` |

### Email (Resend)

| Variable            | Description               | Example             |
| ------------------- | ------------------------- | ------------------- |
| `RESEND_API_KEY`    | Resend API key (optional) | `re_abc123`         |
| `RESEND_FROM_EMAIL` | Sender email address      | `noreply@hotel.com` |

### File Storage

| Variable        | Description                      | Example       |
| --------------- | -------------------------------- | ------------- |
| `AWS_S3_BUCKET` | S3 bucket for reports (optional) | `hfp-reports` |
| `AWS_REGION`    | AWS region                       | `eu-west-1`   |

### Sky Jana SFTP

| Variable               | Description           | Example           |
| ---------------------- | --------------------- | ----------------- |
| `JANA_SFTP_HOST`       | SFTP server hostname  | `sftp.jana.co.tz` |
| `JANA_SFTP_PORT`       | SFTP port             | `22`              |
| `JANA_SFTP_USERNAME`   | SFTP username         | `hfp`             |
| `JANA_SFTP_PASSWORD`   | SFTP password         | `secret`          |
| `JANA_SFTP_REMOTE_DIR` | Remote directory path | `/exports/`       |

### Application

| Variable       | Description                         | Example                 |
| -------------- | ----------------------------------- | ----------------------- |
| `APP_BASE_URL` | Frontend base URL (for email links) | `https://app.hotel.com` |

---

## Web (`apps/web/.env.local`)

| Variable                   | Description               | Example                                   |
| -------------------------- | ------------------------- | ----------------------------------------- |
| `NEXTAUTH_URL`             | NextAuth callback URL     | `http://localhost:3001`                   |
| `NEXTAUTH_SECRET`          | Session encryption secret | `random-32-char-string`                   |
| `NEXT_PUBLIC_API_BASE_URL` | API base URL              | `http://localhost:4000`                   |
| `KEYCLOAK_CLIENT_ID`       | Keycloak OIDC client      | `hfp-web`                                 |
| `KEYCLOAK_CLIENT_SECRET`   | Keycloak OIDC secret      | `secret`                                  |
| `KEYCLOAK_ISSUER`          | OIDC issuer               | `https://keycloak.example.com/realms/hfp` |

---

## Dev Mode

When `NODE_ENV !== 'production'`, the API accepts:

- Bearer token: `dev-token`
- Header: `X-Entity-ID: 00000000-0000-0000-0000-000000000002`
- Roles are hardcoded to `["admin", "superadmin"]`
- No Keycloak required
