# Keycloak Realm Setup Guide

## 1. Create Realm

- Name: `hfp` (HospitalityFinance Pro)
- Display name: HospitalityFinance Pro
- Enabled: Yes

## 2. Create Realm Roles

Create these realm roles matching the EntityRole enum:

| Role Code    | Display Name        | Description                                    |
| ------------ | ------------------- | ---------------------------------------------- |
| `viewer`     | Viewer              | Read-only access to dashboards and reports     |
| `controller` | Controller          | Post journals, approve invoices, close periods |
| `admin`      | Administrator       | Full module access, imports, payment runs      |
| `superadmin` | Super Administrator | Cross-entity operations, system config         |

## 3. Create Clients

### API Client (`hfp-api`)

- Client Protocol: openid-connect
- Access Type: bearer-only (service account)
- Standard Flow: Disabled
- Direct Access Grants: Disabled

### Web Client (`hfp-web`)

- Client Protocol: openid-connect
- Access Type: confidential
- Standard Flow: Enabled
- Valid Redirect URIs: `https://app.hotel.com/*`, `http://localhost:3001/*`
- Web Origins: `https://app.hotel.com`, `http://localhost:3001`
- Client Secret: (generate and set in .env)

## 4. Custom JWT Claims (Client Mappers)

### entity_ids Mapper

On `hfp-web` client, add a Protocol Mapper:

- Name: `entity_ids`
- Mapper Type: User Attribute
- User Attribute: `entity_ids`
- Token Claim Name: `entity_ids`
- Claim JSON Type: JSON
- Add to ID Token: Yes
- Add to Access Token: Yes
- Multivalued: Yes

### roles Mapper

Realm roles are automatically included in `realm_access.roles` claim.

## 5. Create Users

For each hotel/property user:

1. Create user in Keycloak (email, first/last name)
2. Set password (temporary or permanent)
3. Assign realm role (viewer/controller/admin/superadmin)
4. Set user attribute `entity_ids`: JSON array of entity UUIDs
   - Example: `["00000000-0000-0000-0000-000000000002"]`
   - Multiple entities: `["uuid-1","uuid-2"]`
   - Empty array `[]` = superadmin (access all entities)

## 6. Entity-Role Mapping

The API uses TWO role sources:

1. **Keycloak realm roles** (`realm_access.roles` in JWT) - used by `requireRole()` middleware
2. **EntityUser.role** (database) - stored per user-entity pair, used for entity-level access

Both should be kept in sync. The Keycloak role determines API-level access; the EntityUser role determines entity-level permissions.

## 7. Example Token Claims

```json
{
  "sub": "a15c0667-e920-4e66-8b15-e1a561b965c4",
  "email": "admin@hotel.com",
  "name": "Hotel Admin",
  "realm_access": {
    "roles": ["admin", "default-roles-hfp"]
  },
  "entity_ids": ["00000000-0000-0000-0000-000000000002"]
}
```

## 8. Production Checklist

- [ ] Realm created with proper name
- [ ] 4 realm roles created (viewer, controller, admin, superadmin)
- [ ] API client (bearer-only) configured
- [ ] Web client (confidential) with valid redirect URIs
- [ ] entity_ids mapper configured on web client
- [ ] Users created with roles and entity_ids
- [ ] KEYCLOAK_ISSUER and KEYCLOAK_JWKS_URI set in API .env
- [ ] KEYCLOAK_CLIENT_ID and KEYCLOAK_CLIENT_SECRET set in web .env.local
- [ ] HTTPS enforced on Keycloak in production
